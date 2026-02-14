import { httpGetJson, httpGetText, mergeHeaders } from "../../utils/http.js"
import { buildUrl } from "../../utils/url.js"
import { paginateUntil } from "../../utils/paginate.js"
import { parseLiveTonightListingResponse } from "./parse.js"
import type { CacheService } from "../cache-service.js"
import type { ProfileFetchOutcome, VerboseLog } from "../types.js"
import { sanitizeForError } from "../types.js"
import type { UserProfile } from "./normalize.js"

export const DEFAULT_ENDPOINT =
  "https://wasmv8e0b5.execute-api.eu-west-3.amazonaws.com/default/searchMusiciansv2"
export const LIVETONIGHT_PROFILE_BASE_URL = "https://www.livetonight.fr"

export interface SearchParams {
  index: string
  page?: number
  radius?: number
  sortedBy?: string
  address?: string
  lat?: number
  lng?: number
  categories?: string[]
  budget?: [number, number]
  date?: string
  gear?: string[]
  dj?: string
  group?: string
  types?: string[]
  titles?: string[]
  instruments?: string[]
  hitsCount?: number
  timestamp?: string
}

interface FetchListingPagesOptions {
  fetchLimit?: number
  signal?: AbortSignal
  verbose?: VerboseLog
}

interface FetchProfilePageOptions {
  signal?: AbortSignal
}

const commaList = (values: string[] | undefined): string | undefined => {
  if (!values?.length) {
    return undefined
  }
  const cleaned = values.map((value) => value.trim()).filter(Boolean)
  return cleaned.length ? cleaned.join(",") : undefined
}

const toQueryParams = (params: SearchParams): Record<string, string> => {
  const query: Record<string, string> = {
    page: String(params.page ?? 1),
    radius: String(params.radius ?? 50),
    sortedBy: params.sortedBy ?? "pertinence",
    index: params.index,
    timestamp: params.timestamp ?? String(Date.now()),
  }
  if (params.address) query.address = params.address
  if (params.lat !== undefined) query.lat = String(params.lat)
  if (params.lng !== undefined) query.lng = String(params.lng)
  const categories = commaList(params.categories)
  if (categories) query.categories = categories
  if (params.date) query.date = params.date
  const gear = commaList(params.gear)
  if (gear) query.gear = gear
  if (params.dj) query.dj = params.dj
  if (params.group) query.group = params.group
  const types = commaList(params.types)
  if (types) query.types = types
  const titles = commaList(params.titles)
  if (titles) query.titles = titles
  const instruments = commaList(params.instruments)
  if (instruments) query.instruments = instruments
  if (params.hitsCount !== undefined) query.hitsCount = String(params.hitsCount)
  return query
}

export const fetchListingPages = async (
  cacheService: CacheService,
  params: { categories: string[]; djFilter?: string },
  opts: FetchListingPagesOptions,
): Promise<string[]> => {
  const endpoint = DEFAULT_ENDPOINT
  const timeoutMs = 15_000

  const rawJsonResponses: string[] = []
  const seenSlugs = new Set<string>()
  const maxPages = 50
  let totalFetched = 0

  for await (const { items } of paginateUntil<UserProfile>({
    fetchPage: async (pageNum) => {
      const url = buildUrl(
        endpoint,
        toQueryParams({
          index: "users",
          page: pageNum,
          radius: 50,
          sortedBy: "pertinence",
          categories: params.categories,
          dj: params.djFilter,
        }),
      )
      const payloadContent = await cacheService.getOrFetchArtifact({
        artifactType: "listing_response",
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
                    accept: "application/json",
                    origin: LIVETONIGHT_PROFILE_BASE_URL,
                    referer: `${LIVETONIGHT_PROFILE_BASE_URL}/`,
                    "user-agent": "livetonight-get-profiles/0.1 (educational; contact: none)",
                  },
                  {},
                ),
                opts.signal,
              )
            ).body,
          ),
      })
      rawJsonResponses.push(payloadContent)
      const parsed = parseLiveTonightListingResponse(payloadContent)
      return parsed
    },
    firstPage: 1,
    sleepBetweenMs: 100,
    maxPages,
    signal: opts.signal,
  })) {
    if (items.length === 0) {
      break
    }
    for (const item of items) {
      if (opts.fetchLimit !== undefined && totalFetched >= opts.fetchLimit) {
        break
      }
      const key = item.slug ?? String(item.profile_id)
      if (seenSlugs.has(key)) {
        continue
      }
      seenSlugs.add(key)
      totalFetched += 1
    }
    if (opts.fetchLimit !== undefined && totalFetched >= opts.fetchLimit) {
      break
    }
  }

  return rawJsonResponses
}

export const fetchProfilePage = async (
  cacheService: CacheService,
  profileId: number,
  slug: string,
  opts: FetchProfilePageOptions,
): Promise<ProfileFetchOutcome> => {
  const timeoutMs = 15_000
  const url = `${LIVETONIGHT_PROFILE_BASE_URL}/groupe-musique-dj/${profileId}-${slug}`

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
                referer: `${LIVETONIGHT_PROFILE_BASE_URL}/`,
                "user-agent": "livetonight-get-profile/0.1 (educational; contact: none)",
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
        provider: "livetonight",
        step: "profile-fetch",
        target: sanitizeForError(url),
        message: sanitizeForError(message),
      },
    }
  }
}
