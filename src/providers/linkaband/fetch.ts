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
}

export interface FetchProfilePageOptions {
  signal?: AbortSignal
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
  })
  .loose()

const linkabandProfileBatchResponseSchema = z.array(z.record(z.string(), z.unknown()))

const extractArtistIds = (payload: unknown): number[] => {
  const parsed = linkabandRecommendationResponseSchema.safeParse(payload)
  if (!parsed.success) {
    return []
  }
  const values = parsed.data.artist_ids ?? parsed.data.artistIds ?? []
  return values
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
  const maxPages = 200
  const seen = new Set<number>()
  const ids: number[] = []
  let page = 0
  let stagnantPages = 0

  while (page < maxPages) {
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
      }),
    )
    const payloadContent = await cacheService.getOrFetchArtifact({
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
    let payload: unknown
    try {
      payload = JSON.parse(payloadContent)
    } catch {
      throw new Error(`Invalid JSON artifact payload for ${url}`)
    }
    const pageIds = extractArtistIds(payload)
    if (pageIds.length === 0) {
      break
    }

    let added = 0
    for (const id of pageIds) {
      if (opts.fetchLimit !== undefined && ids.length >= opts.fetchLimit) {
        break
      }
      if (seen.has(id)) {
        continue
      }
      seen.add(id)
      ids.push(id)
      added += 1
    }

    if (opts.fetchLimit !== undefined && ids.length >= opts.fetchLimit) {
      break
    }

    if (added === 0) {
      stagnantPages += 1
      if (stagnantPages >= 2) {
        break
      }
    } else {
      stagnantPages = 0
    }

    page += 1
    await sleep(sleepMs, opts.signal)
  }

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

  const chunks: number[][] = []
  for (let idx = 0; idx < artistIds.length; idx += chunkSize) {
    chunks.push(artistIds.slice(idx, idx + chunkSize))
  }

  const allArtists: Record<string, unknown>[] = []
  for (let idx = 0; idx < chunks.length; idx += 1) {
    throwIfAborted(opts.signal)
    if (idx > 0) {
      await sleep(sleepMs, opts.signal)
    }
    const batch = chunks[idx]
    const url = buildUrl(DEFAULT_ENDPOINT, { artistsIds: batch.join(",") })
    const payloadContent = await cacheService.getOrFetchArtifact({
      artifactType: "listing_profile_batch_response",
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
    let raw: unknown
    try {
      raw = JSON.parse(payloadContent)
    } catch {
      throw new Error(`Invalid JSON artifact payload for ${url}`)
    }
    const parsed = linkabandProfileBatchResponseSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error("Linkaband profile API returned non-array payload")
    }
    allArtists.push(...parsed.data)
  }

  return allArtists
}

export const fetchProfilePage = async (
  cacheService: CacheService,
  slug: string,
  opts: FetchProfilePageOptions,
): Promise<ProfileFetchOutcome> => {
  const timeoutMs = 15_000
  const url = `${LINKABAND_PROFILE_BASE_URL}/${encodeURIComponent(slug)}`

  try {
    const html = await cacheService.getOrFetchArtifact({
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
    return { success: true, target: url, html }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
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
