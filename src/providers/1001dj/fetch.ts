import { writeFile } from "node:fs/promises"

import { httpGetText, mergeHeaders } from "../../utils/http.js"
import pLimit from "p-limit"
import { sleep } from "../../utils/sleep.js"
import type { ParsedOutput } from "../../schema/validate.js"
import { buildUrl } from "../../utils/url.js"
import { paginateUntil } from "../../utils/paginate.js"
import { extractProfilesFromHtml, parseProfileList } from "./parse-list.js"
import { parseProfilePage } from "./parse-profile.js"

export interface SearchParams {
  page?: number
  provider?: string
  typologyText?: string
  typologyIds?: number[]
  locationId?: number
  locationType?: number
  location?: string
  typeEventId?: number
  typeEvent?: string
}

export const DEFAULT_ENDPOINT = "https://www.1001dj.com/recherche"
export const PROFILE_BASE_URL = "https://www.1001dj.com"

const defaultSearchParams = (): SearchParams => ({
  page: 1,
  typeEvent: "mariage",
})

const toQueryParams = (params: SearchParams): Record<string, string | string[] | undefined> => ({
  "form-search-page": params.page !== undefined ? String(params.page) : undefined,
  "form-search-provider": params.provider,
  "form-search-typology-text": params.typologyText,
  "form-search-typology[]": params.typologyIds?.map((id) => String(id)),
  "form-search-location-id": params.locationId !== undefined ? String(params.locationId) : undefined,
  "form-search-location-type": params.locationType !== undefined ? String(params.locationType) : undefined,
  "form-search-location": params.location,
  "form-search-type-event-id": params.typeEventId !== undefined ? String(params.typeEventId) : undefined,
  "form-search-type-event": params.typeEvent,
})

export const fetchAndParse1001dj = async (options: {
  outputFile: string
  dryRun: boolean
  endpoint?: string
  timeoutMs?: number
  userAgent?: string
  params?: Partial<SearchParams>
  fetchProfilePages?: boolean
  fetchLimit?: number
  profileConcurrency?: boolean
  profileDelayMs?: number
  onFetchProgress?: (current: number, total: number, status?: string) => void
  verbose?: (provider: string, message: string) => void
  signal?: AbortSignal
}): Promise<number> => {
  const log = options.verbose
  const timeoutMs = options.timeoutMs ?? 20_000
  const fetchProfilePages = options.fetchProfilePages ?? true
  const profileDelayMs = options.profileDelayMs ?? 30
  const concurrency = options.profileConcurrency === false ? 1 : 4
  if (options.dryRun) {
    return 0
  }
  log?.("1001dj", "fetching profile list…")
  const result = await getProfiles1001dj({
    endpoint: options.endpoint,
    timeoutMs,
    userAgent: options.userAgent,
    params: options.params,
    fetchLimit: options.fetchLimit,
    onFetchProgress: options.onFetchProgress,
    signal: options.signal,
  })
  log?.("1001dj", `profile list done (${result.meta.count} profiles)`)
  const referer = buildUrl(options.endpoint ?? DEFAULT_ENDPOINT, toQueryParams({
    ...defaultSearchParams(),
    ...(options.params ?? {}),
  }))
  const userAgent = options.userAgent ?? "1001dj-get-profiles/0.1 (educational; contact: none)"

  if (fetchProfilePages) {
    let profilePagesFetched = 0
    let profilePagesFailed = 0
    const profileItems = result.results.filter((item) => item.kind === "profile" && Boolean(item.normalized.url))
    const totalProfileItems = profileItems.length
    let processedProfileItems = 0
    log?.("1001dj", `starting profile pages (${totalProfileItems} pages, concurrency=${concurrency})`)
    options.onFetchProgress?.(0, totalProfileItems)
    const limit = pLimit(concurrency)
    await Promise.all(
      profileItems.map((item) =>
        limit(async () => {
          const profileUrl = item.normalized.url
          if (!profileUrl) {
            return
          }
          try {
            const parsedProfile = await getProfile1001dj({
              profileUrl,
              referer,
              timeoutMs,
              userAgent,
              signal: options.signal,
            })
            item.normalized.description = item.normalized.description ?? parsedProfile.description
            if (parsedProfile.ratingValue !== null) {
              item.normalized.ratings.value = parsedProfile.ratingValue
            }
            if (parsedProfile.ratingCount !== null) {
              item.normalized.ratings.count = parsedProfile.ratingCount
            }
            if (parsedProfile.ratingPerformance !== null) {
              item.normalized.attributes = {
                ...(item.normalized.attributes ?? {}),
                rating_performance_1001dj: parsedProfile.ratingPerformance,
              }
            }
            item.normalized.media.image_url = item.normalized.media.image_url ?? parsedProfile.imageUrl

            if (item.normalized.pricing.min === null && parsedProfile.pricingMin !== null) {
              item.normalized.pricing.min = parsedProfile.pricingMin
            }
            if (item.normalized.pricing.max === null && parsedProfile.pricingMax !== null) {
              item.normalized.pricing.max = parsedProfile.pricingMax
            }
            if (item.normalized.pricing.currency === null && parsedProfile.pricingCurrency !== null) {
              item.normalized.pricing.currency = parsedProfile.pricingCurrency
            }
            if (item.normalized.pricing.raw === null && parsedProfile.pricesFound.length > 0) {
              item.normalized.pricing.raw = {
                prices_found: parsedProfile.pricesFound,
                source: "profile_page",
              }
            }
            profilePagesFetched += 1
          } catch {
            profilePagesFailed += 1
          }
          processedProfileItems += 1
          options.onFetchProgress?.(processedProfileItems, totalProfileItems)
          await sleep(profileDelayMs, options.signal)
        }),
      ),
    )
    log?.("1001dj", `profile pages done (fetched=${profilePagesFetched}, failed=${profilePagesFailed})`)
    result.meta.profilePagesFetched = profilePagesFetched
    result.meta.profilePagesFailed = profilePagesFailed
  }

  log?.("1001dj", "writing output file")
  await writeFile(options.outputFile, `${JSON.stringify(result, null, 2)}\n`, "utf-8")
  return result.meta.count
}

export const getProfiles1001dj = async (options: {
  endpoint?: string
  timeoutMs?: number
  userAgent?: string
  params?: Partial<SearchParams>
  fetchLimit?: number
  maxPages?: number
  sleepBetweenMs?: number
  onFetchProgress?: (current: number, total: number, status?: string) => void
  signal?: AbortSignal
}): Promise<ParsedOutput> => {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT
  const timeoutMs = options.timeoutMs ?? 20_000
  const userAgent = options.userAgent ?? "1001dj-get-profiles/0.1 (educational; contact: none)"
  const baseParams: SearchParams = {
    ...defaultSearchParams(),
    ...(options.params ?? {}),
  }

  const htmlPages: string[] = []
  const seenUrls = new Set<string>()
  let stagnantPages = 0
  const maxPages = options.maxPages ?? 50

  for await (const { page, items } of paginateUntil<{ html: string; urls: string[] }>({
    fetchPage: async (pageNum) => {
      const params: SearchParams = { ...baseParams, page: pageNum }
      const url = buildUrl(endpoint, toQueryParams(params))
      const response = await httpGetText(
        url,
        timeoutMs,
        mergeHeaders(
          {
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "user-agent": userAgent,
            "cache-control": "no-cache",
            pragma: "no-cache",
          },
          {},
        ),
        options.signal,
      )
      const entries = extractProfilesFromHtml(response.body)
      const urls = entries.map((entry) => entry.url).filter((url): url is string => Boolean(url))
      if (urls.length === 0) {
        return []
      }
      return [{ html: response.body, urls }]
    },
    firstPage: 1,
    sleepBetweenMs: options.sleepBetweenMs ?? 100,
    maxPages,
    signal: options.signal,
  })) {
    if (items.length === 0) {
      break
    }
    let addedThisPage = 0
    for (const item of items) {
      htmlPages.push(item.html)
      for (const url of item.urls) {
        if (seenUrls.has(url)) {
          continue
        }
        seenUrls.add(url)
        addedThisPage += 1
      }
    }
    const listingCount = options.fetchLimit !== undefined ? Math.min(seenUrls.size, options.fetchLimit) : seenUrls.size
    options.onFetchProgress?.(page, maxPages, `listing — ${listingCount} profiles`)

    if (addedThisPage === 0) {
      stagnantPages += 1
      if (stagnantPages >= 2) {
        break
      }
    } else {
      stagnantPages = 0
    }

    if (options.fetchLimit !== undefined && seenUrls.size >= options.fetchLimit) {
      break
    }
  }

  const parsed = parseProfileList(htmlPages)
  if (options.fetchLimit === undefined || parsed.results.length <= options.fetchLimit) {
    return parsed
  }
  return {
    ...parsed,
    meta: {
      ...parsed.meta,
      count: options.fetchLimit,
    },
    results: parsed.results.slice(0, options.fetchLimit),
  }
}

export const getProfile1001dj = async (options: {
  profileUrl: string
  referer?: string
  timeoutMs?: number
  userAgent?: string
  signal?: AbortSignal
}) => {
  const timeoutMs = options.timeoutMs ?? 20_000
  const userAgent = options.userAgent ?? "1001dj-get-profile/0.1 (educational; contact: none)"
  const profileUrl = options.profileUrl.startsWith("http")
    ? options.profileUrl
    : `${PROFILE_BASE_URL}${options.profileUrl.startsWith("/") ? "" : "/"}${options.profileUrl}`
  const profileResponse = await httpGetText(
    profileUrl,
    timeoutMs,
    mergeHeaders(
      {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent": userAgent,
        referer: options.referer ?? `${PROFILE_BASE_URL}/`,
        "cache-control": "no-cache",
        pragma: "no-cache",
      },
      {},
    ),
    options.signal,
  )
  return parseProfilePage(profileResponse.body)
}
