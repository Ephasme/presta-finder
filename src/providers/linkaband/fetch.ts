import { writeFile } from "node:fs/promises"

import pLimit from "p-limit"
import { sleep } from "../../utils/sleep.js"
import { throwIfAborted } from "../../utils/cancel.js"
import { httpGetJson, httpGetText, mergeHeaders } from "../../utils/http.js"
import type { ParsedOutput } from "../../schema/validate.js"
import { buildUrl } from "../../utils/url.js"
import { parseLinkaband } from "./parse.js"
import { parseLinkabandProfilePage } from "./parse-profile.js"

export const DEFAULT_ENDPOINT = "https://api.linkaband.com/api/search/musicians"
export const RECOMMENDATIONS_ENDPOINT = "https://recommendations.linkaband.com/content_based/sim/search"
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
  superArtisteType?: number
  limit?: number
  config?: string
}

const toRecommendationsQuery = (params: RecommendationsParams): Record<string, string | undefined> => ({
  landing_type: params.landingType,
  artist_types: params.artistTypes?.length ? JSON.stringify(params.artistTypes) : undefined,
  longitude: String(params.longitude),
  latitude: String(params.latitude),
  page: String(params.page),
  date_from: params.dateFrom,
  date_to: params.dateTo,
  price_min: params.priceMin !== undefined ? String(params.priceMin) : undefined,
  price_max: params.priceMax !== undefined ? String(params.priceMax) : undefined,
  super_artiste_type: params.superArtisteType !== undefined ? String(params.superArtisteType) : undefined,
  limit: params.limit !== undefined ? String(params.limit) : undefined,
  config: params.config,
})

const extractArtistIds = (payload: unknown): number[] => {
  if (!payload || typeof payload !== "object") {
    return []
  }
  const record = payload as Record<string, unknown>
  const values = Array.isArray(record.artist_ids)
    ? record.artist_ids
    : Array.isArray(record.artistIds)
      ? record.artistIds
      : []
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

const chunk = (items: number[], size: number): number[][] => {
  const chunks: number[][] = []
  for (let idx = 0; idx < items.length; idx += size) {
    chunks.push(items.slice(idx, idx + size))
  }
  return chunks
}

const collectRecommendationIds = async (args: {
  longitude: number
  latitude: number
  dateFrom: string
  dateTo: string
  fetchLimit?: number
  timeoutMs: number
  sleepMs: number
  maxPages: number
  onFetchProgress?: (current: number, total: number, status?: string) => void
  signal?: AbortSignal
}): Promise<number[]> => {
  const seen = new Set<number>()
  const ids: number[] = []
  let page = 0
  let stagnantPages = 0

  while (page < args.maxPages) {
    throwIfAborted(args.signal)
    const url = buildUrl(
      RECOMMENDATIONS_ENDPOINT,
      toRecommendationsQuery({
        landingType: "mariage",
        artistTypes: ["dj"],
        longitude: args.longitude,
        latitude: args.latitude,
        page,
        dateFrom: args.dateFrom,
        dateTo: args.dateTo,
      }),
    )
    const response = await httpGetJson<unknown>(
      url,
      args.timeoutMs,
      mergeHeaders(
        {
          accept: "application/json, text/plain, */*",
          "user-agent": "linkaband-get-profiles/0.1 (educational; contact: none)",
        },
        {},
      ),
      args.signal,
    )
    const pageIds = extractArtistIds(response.body)
    if (pageIds.length === 0) {
      break
    }

    let added = 0
    for (const id of pageIds) {
      if (args.fetchLimit !== undefined && ids.length >= args.fetchLimit) {
        break
      }
      if (seen.has(id)) {
        continue
      }
      seen.add(id)
      ids.push(id)
      added += 1
    }

    args.onFetchProgress?.(page + 1, args.maxPages, `listing — ${ids.length} IDs`)

    if (args.fetchLimit !== undefined && ids.length >= args.fetchLimit) {
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
    await sleep(args.sleepMs, args.signal)
  }

  return ids
}

const fetchProfileBatch = async (args: {
  endpoint: string
  artistsIds: number[]
  token: string
  timeoutMs: number
  signal?: AbortSignal
}): Promise<Record<string, unknown>[]> => {
  const url = buildUrl(args.endpoint, { artistsIds: args.artistsIds.join(",") })
  const response = await httpGetJson<unknown>(
    url,
    args.timeoutMs,
    mergeHeaders(
      {
        accept: "application/json, text/plain, */*",
        origin: "https://linkaband.com",
        referer: "https://linkaband.com/",
        "user-agent": "linkaband-get-profiles/0.1 (educational; contact: none)",
        "x-auth-token": args.token,
      },
      {},
    ),
    args.signal,
  )
  if (!Array.isArray(response.body)) {
    throw new Error("Linkaband profile API returned non-array payload")
  }
  return response.body.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
}

export const fetchAndParseLinkaband = async (args: {
  outputFile: string
  dryRun: boolean
  lat: number
  lng: number
  dateFrom: string
  dateTo: string
  authToken: string | null
  timeoutMs?: number
  fetchLimit?: number
  chunkSize?: number
  sleepMs?: number
  profileDelayMs?: number
  profileConcurrency?: boolean
  onFetchProgress?: (current: number, total: number, status?: string) => void
  verbose?: (provider: string, message: string) => void
  signal?: AbortSignal
}): Promise<number> => {
  const log = args.verbose
  throwIfAborted(args.signal)
  if (args.dryRun) {
    return 0
  }
  if (!args.authToken) {
    throw new Error("LINKABAND_API_KEY is required for Linkaband")
  }

  const timeoutMs = args.timeoutMs ?? 15_000
  const chunkSize = args.chunkSize ?? 20
  const sleepMs = args.sleepMs ?? 30
  const profileDelayMs = args.profileDelayMs ?? 30
  const concurrency = args.profileConcurrency === false ? 1 : 4

  log?.("linkaband", "fetching profile list…")
  const result = await getProfilesLinkaband({
    lat: args.lat,
    lng: args.lng,
    dateFrom: args.dateFrom,
    dateTo: args.dateTo,
    authToken: args.authToken,
    timeoutMs,
    fetchLimit: args.fetchLimit,
    chunkSize,
    sleepMs,
    onFetchProgress: args.onFetchProgress,
    signal: args.signal,
  })

  log?.("linkaband", `profile list done (${result.meta.count} profiles)`)
  let profilePagesFetched = 0
  let profilePagesFailed = 0
  const profileItems = result.results.filter((item) => item.kind === "profile" && Boolean(item.normalized.slug))
  const totalProfileItems = profileItems.length
  let processedProfileItems = 0
  log?.("linkaband", `starting profile pages (${totalProfileItems} pages, concurrency=${concurrency})`)
  args.onFetchProgress?.(0, totalProfileItems)
  const limit = pLimit(concurrency)
  await Promise.all(
    profileItems.map((item) =>
      limit(async () => {
        const slug = item.normalized.slug
        if (!slug) {
          return
        }
        try {
          const page = await getProfileLinkaband({
            slug,
            timeoutMs,
            signal: args.signal,
          })
          item.normalized.description = item.normalized.description ?? page.description
          if (page.ratingValue !== null) {
            // Profile header metric (e.g. "5.0 (10)") is authoritative.
            item.normalized.ratings.value = page.ratingValue
          }
          if (page.ratingCount !== null) {
            item.normalized.ratings.count = page.ratingCount
          }
          item.normalized.media.image_url = item.normalized.media.image_url ?? page.imageUrl
          if (item.normalized.pricing.min === null && page.pricingMin !== null) {
            item.normalized.pricing.min = page.pricingMin
          }
          if (item.normalized.pricing.max === null && page.pricingMax !== null) {
            item.normalized.pricing.max = page.pricingMax
          }
          if (item.normalized.pricing.currency === null && page.pricingCurrency !== null) {
            item.normalized.pricing.currency = page.pricingCurrency
          }
          profilePagesFetched += 1
        } catch {
          profilePagesFailed += 1
        }
        processedProfileItems += 1
        args.onFetchProgress?.(processedProfileItems, totalProfileItems)
        await sleep(profileDelayMs, args.signal)
      }),
    ),
  )
  log?.("linkaband", `profile pages done (fetched=${profilePagesFetched}, failed=${profilePagesFailed})`)
  result.meta.profilePagesFetched = profilePagesFetched
  result.meta.profilePagesFailed = profilePagesFailed

  log?.("linkaband", "writing output file")
  await writeFile(args.outputFile, `${JSON.stringify(result, null, 2)}\n`, "utf-8")
  return result.meta.count
}

export const getProfilesLinkaband = async (args: {
  lat: number
  lng: number
  dateFrom: string
  dateTo: string
  authToken: string | null
  timeoutMs?: number
  fetchLimit?: number
  chunkSize?: number
  sleepMs?: number
  maxPages?: number
  onFetchProgress?: (current: number, total: number, status?: string) => void
  signal?: AbortSignal
}): Promise<ParsedOutput> => {
  throwIfAborted(args.signal)
  if (!args.authToken) {
    throw new Error("LINKABAND_API_KEY is required for Linkaband")
  }
  const timeoutMs = args.timeoutMs ?? 15_000
  const chunkSize = args.chunkSize ?? 20
  const sleepMs = args.sleepMs ?? 30

  const maxPages = args.maxPages ?? 200
  const ids = await collectRecommendationIds({
    longitude: args.lng,
    latitude: args.lat,
    dateFrom: args.dateFrom,
    dateTo: args.dateTo,
    fetchLimit: args.fetchLimit,
    timeoutMs,
    sleepMs,
    maxPages,
    onFetchProgress: args.onFetchProgress,
    signal: args.signal,
  })
  if (!ids.length) {
    throw new Error("No artist IDs returned by Linkaband recommendations")
  }

  const batches = chunk(ids, chunkSize)
  const allArtists: Record<string, unknown>[] = []
  for (let idx = 0; idx < batches.length; idx += 1) {
    throwIfAborted(args.signal)
    if (idx > 0) {
      await sleep(sleepMs, args.signal)
    }
    const batch = batches[idx]
    const records = await fetchProfileBatch({
      endpoint: DEFAULT_ENDPOINT,
      artistsIds: batch ?? [],
      token: args.authToken,
      timeoutMs,
      signal: args.signal,
    })
    allArtists.push(...records)
    args.onFetchProgress?.(idx + 1, batches.length, `batch ${idx + 1}/${batches.length} — ${allArtists.length} profiles`)
  }
  return parseLinkaband(allArtists)
}

export const getProfileLinkaband = async (args: {
  slug: string
  timeoutMs?: number
  signal?: AbortSignal
}) => {
  const timeoutMs = args.timeoutMs ?? 15_000
  const url = `${LINKABAND_PROFILE_BASE_URL}/${encodeURIComponent(args.slug)}`
  const response = await httpGetText(
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
    args.signal,
  )
  return parseLinkabandProfilePage(response.body)
}
