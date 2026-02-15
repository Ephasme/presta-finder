import { z } from "zod"
import { sleep } from "../../utils/sleep.js"
import { throwIfAborted } from "../../utils/cancel.js"
import { httpGetJson, httpGetText, mergeHeaders } from "../../utils/http.js"
import { buildUrl } from "../../utils/url.js"
import type { CacheService } from "../cache-service.js"
import type { ProfileFetchOutcome, VerboseLog } from "../types.js"
import { sanitizeForError } from "../types.js"

export const DEFAULT_ENDPOINT = "https://api.linkaband.com/api/search/musicians"
export const RECOMMENDATIONS_ENDPOINT =
  "https://recommendations.linkaband.com/content_based/sim/search"
export const LINKABAND_PROFILE_BASE_URL = "https://linkaband.com"
const DEFAULT_RECOMMENDATION_LIMIT = 18
const DEFAULT_RECOMMENDATION_CONFIG = "v0.4.0"
const DEFAULT_SUPER_ARTIST_TYPE = 1

interface RecommendationsParams {
  landingType?: string
  artistTypes?: string[]
  longitude: number
  latitude: number
  page: number
  dateFrom: string
  dateTo: string
  priceMin?: number
  priceMax?: number
  superArtistType?: number
  limit?: number
  config?: string
}

export interface CollectRecommendationIdsOptions {
  fetchLimit?: number
  signal?: AbortSignal
  verbose?: VerboseLog
}

export interface FetchProfileBatchesOptions {
  fetchLimit?: number
  signal?: AbortSignal
  verbose?: VerboseLog
}

export interface FetchProfilePageOptions {
  signal?: AbortSignal
  verbose?: VerboseLog
}

const toRecommendationsQuery = (
  params: RecommendationsParams,
): Record<string, string | undefined> => ({
  landing_type: params.landingType,
  artist_types: params.artistTypes?.length ? JSON.stringify(params.artistTypes) : undefined,
  longitude: String(params.longitude),
  latitude: String(params.latitude),
  page: String(params.page),
  date_from: params.dateFrom,
  date_to: params.dateTo,
  price_min: params.priceMin !== undefined ? String(params.priceMin) : undefined,
  price_max: params.priceMax !== undefined ? String(params.priceMax) : undefined,
  super_artiste_type:
    params.superArtistType !== undefined ? String(params.superArtistType) : undefined,
  limit: params.limit !== undefined ? String(params.limit) : undefined,
  config: params.config,
})

const linkabandRecommendationResponseSchema = z
  .object({
    artist_ids: z.array(z.union([z.number(), z.string()])).optional(),
    artistIds: z.array(z.union([z.number(), z.string()])).optional(),
    total_recommendations_count: z.union([z.number(), z.string()]).optional(),
    relevant_recommendations_count: z.union([z.number(), z.string()]).optional(),
  })
  .loose()

const linkabandProfileBatchResponseSchema = z.array(z.record(z.string(), z.unknown()))

const parseIntOrNull = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value)
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    return Number.parseInt(value, 10)
  }
  return null
}

const extractRecommendationPayload = (
  payload: unknown,
): { ids: number[]; totalCount: number | null; relevantCount: number | null } => {
  const parsed = linkabandRecommendationResponseSchema.safeParse(payload)
  if (!parsed.success) {
    return { ids: [], totalCount: null, relevantCount: null }
  }
  const values = parsed.data.artist_ids ?? parsed.data.artistIds ?? []
  const ids = values
    .map((value) => {
      if (typeof value === "number" && Number.isInteger(value)) {
        return value
      }
      if (typeof value === "string" && /^[0-9]+$/.test(value)) {
        return Number.parseInt(value, 10)
      }
      return null
    })
    .filter((value): value is number => value !== null)
  return {
    ids,
    totalCount: parseIntOrNull(parsed.data.total_recommendations_count),
    relevantCount: parseIntOrNull(parsed.data.relevant_recommendations_count),
  }
}

export const collectRecommendationIds = async (
  cacheService: CacheService,
  params: {
    longitude: number
    latitude: number
    dateFrom: string
    dateTo: string
    landingType: string
    artistTypes: string[]
  },
  opts: CollectRecommendationIdsOptions,
): Promise<number[]> => {
  const timeoutMs = 15_000
  const sleepMs = 30
  const recommendationLimit = DEFAULT_RECOMMENDATION_LIMIT
  const log = (message: string): void => {
    opts.verbose?.("linkaband", message)
  }
  const seen = new Set<number>()
  const ids: number[] = []
  let page = 0
  let pagesFetched = 0

  log(
    `recommendations start (endpoint=${RECOMMENDATIONS_ENDPOINT}, landingType=${params.landingType}, artistTypes=${JSON.stringify(params.artistTypes)}, longitude=${params.longitude}, latitude=${params.latitude}, dateFrom=${params.dateFrom}, dateTo=${params.dateTo}, perPage=${recommendationLimit}, fetchLimit=${opts.fetchLimit ?? "none"})`,
  )

  for (;;) {
    throwIfAborted(opts.signal)
    const url = buildUrl(
      RECOMMENDATIONS_ENDPOINT,
      toRecommendationsQuery({
        landingType: params.landingType,
        artistTypes: params.artistTypes,
        longitude: params.longitude,
        latitude: params.latitude,
        page,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        superArtistType: DEFAULT_SUPER_ARTIST_TYPE,
        limit: recommendationLimit,
        config: DEFAULT_RECOMMENDATION_CONFIG,
      }),
    )
    log(`recommendations page fetch start (page=${page}, url=${sanitizeForError(url)})`)
    const payload = await cacheService.getJSON({
      artifactType: "listing_recommendation_response",
      request: {
        method: "GET",
        url,
      },
      fetchContent: async () =>
        JSON.stringify(
          (
            await httpGetJson(
              url,
              timeoutMs,
              mergeHeaders(
                {
                  accept: "application/json, text/plain, */*",
                  "user-agent": "linkaband-get-profiles/0.1 (educational; contact: none)",
                },
                {},
              ),
              opts.signal,
            )
          ).body,
        ),
    })
    const payloadContent = JSON.stringify(payload)
    pagesFetched += 1
    log(
      `recommendations page fetch done (page=${page}, bytes=${payloadContent.length}, uniqueBeforeParse=${ids.length})`,
    )
    const { ids: pageIds, totalCount, relevantCount } = extractRecommendationPayload(payload)
    if (pageIds.length === 0) {
      log(
        `recommendations stop: empty page (page=${page}, totalCount=${totalCount ?? "unknown"}, relevantCount=${relevantCount ?? "unknown"}, pagesFetched=${pagesFetched})`,
      )
      break
    }

    let added = 0
    let duplicates = 0
    for (const id of pageIds) {
      if (opts.fetchLimit !== undefined && ids.length >= opts.fetchLimit) {
        break
      }
      if (seen.has(id)) {
        duplicates += 1
        continue
      }
      seen.add(id)
      ids.push(id)
      added += 1
    }
    const sample = pageIds.slice(0, 5).join(",")
    log(
      `recommendations page parsed (page=${page}, idsInPage=${pageIds.length}, added=${added}, duplicates=${duplicates}, uniqueTotal=${ids.length}, totalCount=${totalCount ?? "unknown"}, relevantCount=${relevantCount ?? "unknown"}, sample=[${sample}])`,
    )

    if (opts.fetchLimit !== undefined && ids.length >= opts.fetchLimit) {
      log(`recommendations stop: fetchLimit reached (fetchLimit=${opts.fetchLimit})`)
      break
    }

    page += 1
    await sleep(sleepMs, opts.signal)
  }

  log(`recommendations done (pagesFetched=${pagesFetched}, uniqueIds=${ids.length})`)
  return ids
}

export const fetchProfileBatches = async (
  cacheService: CacheService,
  artistIds: number[],
  authToken: string,
  opts: FetchProfileBatchesOptions,
): Promise<Record<string, unknown>[]> => {
  const timeoutMs = 15_000
  const chunkSize = 20
  const sleepMs = 30
  const log = (message: string): void => {
    opts.verbose?.("linkaband", message)
  }

  const chunks: number[][] = []
  for (let idx = 0; idx < artistIds.length; idx += chunkSize) {
    chunks.push(artistIds.slice(idx, idx + chunkSize))
  }
  log(
    `profile batches start (artistIds=${artistIds.length}, chunkSize=${chunkSize}, chunks=${chunks.length})`,
  )

  const allArtists: Record<string, unknown>[] = []
  for (let idx = 0; idx < chunks.length; idx += 1) {
    throwIfAborted(opts.signal)
    if (idx > 0) {
      await sleep(sleepMs, opts.signal)
    }
    const batch = chunks[idx]
    const url = buildUrl(DEFAULT_ENDPOINT, { artistsIds: batch.join(",") })
    log(
      `profile batch fetch start (chunk=${idx + 1}/${chunks.length}, requestedIds=${batch.length}, url=${sanitizeForError(url)})`,
    )
    const raw = await cacheService.getJSON<Record<string, unknown>[]>({
      artifactType: "listing_profile_batch_response",
      request: {
        method: "GET",
        url,
      },
      schema: linkabandProfileBatchResponseSchema,
      fetchContent: async () =>
        JSON.stringify(
          (
            await httpGetJson(
              url,
              timeoutMs,
              mergeHeaders(
                {
                  accept: "application/json, text/plain, */*",
                  origin: "https://linkaband.com",
                  referer: "https://linkaband.com/",
                  "user-agent": "linkaband-get-profiles/0.1 (educational; contact: none)",
                  "x-auth-token": authToken,
                },
                {},
              ),
              opts.signal,
            )
          ).body,
        ),
    })
    const payloadContent = JSON.stringify(raw)
    log(`profile batch fetch done (chunk=${idx + 1}/${chunks.length}, bytes=${payloadContent.length})`)
    log(
      `profile batch parsed (chunk=${idx + 1}/${chunks.length}, returnedProfiles=${raw.length})`,
    )
    allArtists.push(...raw)
  }

  log(`profile batches done (returnedProfiles=${allArtists.length})`)
  return allArtists
}

export const fetchProfilePage = async (
  cacheService: CacheService,
  slug: string,
  opts: FetchProfilePageOptions,
): Promise<ProfileFetchOutcome> => {
  const timeoutMs = 15_000
  const url = `${LINKABAND_PROFILE_BASE_URL}/${encodeURIComponent(slug)}`
  opts.verbose?.("linkaband", `profile page fetch start (slug=${slug}, url=${url})`)

  try {
    const html = await cacheService.getHTML({
      artifactType: "profile_page",
      request: {
        method: "GET",
        url,
      },
      fetchContent: async () =>
        (
          await httpGetText(
            url,
            timeoutMs,
            mergeHeaders(
              {
                accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                origin: LINKABAND_PROFILE_BASE_URL,
                referer: `${LINKABAND_PROFILE_BASE_URL}/`,
                "user-agent": "linkaband-get-profile/0.1 (educational; contact: none)",
              },
              {},
            ),
            opts.signal,
          )
        ).body,
    })
    opts.verbose?.("linkaband", `profile page fetch done (slug=${slug}, bytes=${html.length})`)
    return { success: true, target: url, html }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    opts.verbose?.(
      "linkaband",
      `profile page fetch failed (slug=${slug}, message=${sanitizeForError(message)})`,
    )
    return {
      success: false,
      target: url,
      error: {
        code: "PROFILE_FETCH_FAILED",
        provider: "linkaband",
        step: "profile-fetch",
        target: sanitizeForError(url),
        message: sanitizeForError(message),
      },
    }
  }
}
