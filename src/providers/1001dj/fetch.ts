import { httpGetText, mergeHeaders } from "../../utils/http.js"
import { buildUrl } from "../../utils/url.js"
import { paginateUntil } from "../../utils/paginate.js"
import { extractProfilesFromHtml } from "./parse-list.js"
import type { CacheService } from "../cache-service.js"
import type { ProfileFetchOutcome, VerboseLog } from "../types.js"
import { sanitizeForError } from "../types.js"

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

interface ListingBatchItem {
  html: string
  urls: string[]
}

interface FetchListingPagesOptions {
  fetchLimit?: number
  signal?: AbortSignal
  verbose?: VerboseLog
}

interface FetchProfilePageOptions {
  referer?: string
  signal?: AbortSignal
}

const defaultSearchParams = (): SearchParams => ({
  page: 1,
  typeEvent: "mariage",
})

const toQueryParams = (params: SearchParams): Record<string, string | string[] | undefined> => ({
  "form-search-page": params.page !== undefined ? String(params.page) : undefined,
  "form-search-provider": params.provider,
  "form-search-typology-text": params.typologyText,
  "form-search-typology[]": params.typologyIds?.map((id) => String(id)),
  "form-search-location-id":
    params.locationId !== undefined ? String(params.locationId) : undefined,
  "form-search-location-type":
    params.locationType !== undefined ? String(params.locationType) : undefined,
  "form-search-location": params.location,
  "form-search-type-event-id":
    params.typeEventId !== undefined ? String(params.typeEventId) : undefined,
  "form-search-type-event": params.typeEvent,
})

export const fetchListingPages = async (
  cacheService: CacheService,
  params: Partial<SearchParams>,
  opts: FetchListingPagesOptions,
): Promise<string[]> => {
  const endpoint = DEFAULT_ENDPOINT
  const timeoutMs = 20_000
  const userAgent = "1001dj-get-profiles/0.1 (educational; contact: none)"
  const baseParams: SearchParams = {
    ...defaultSearchParams(),
    ...params,
  }

  const htmlPages: string[] = []
  const seenUrls = new Set<string>()
  let stagnantPages = 0
  const maxPages = 50

  for await (const { items } of paginateUntil<ListingBatchItem>({
    fetchPage: async (pageNum) => {
      const pageParams: SearchParams = { ...baseParams, page: pageNum }
      const url = buildUrl(endpoint, toQueryParams(pageParams))
      const responseBody = await cacheService.getHTML({
        artifactType: "listing_page",
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
                  "user-agent": userAgent,
                  "cache-control": "no-cache",
                  pragma: "no-cache",
                },
                {},
              ),
              opts.signal,
            )
          ).body,
      })
      const entries = extractProfilesFromHtml(responseBody)
      const urls = entries
        .map((entry) => entry.url)
        .filter((urlValue): urlValue is string => Boolean(urlValue))
      if (urls.length === 0) {
        return []
      }
      return [{ html: responseBody, urls }]
    },
    firstPage: 1,
    sleepBetweenMs: 100,
    maxPages,
    signal: opts.signal,
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

    if (addedThisPage === 0) {
      stagnantPages += 1
      if (stagnantPages >= 2) {
        break
      }
    } else {
      stagnantPages = 0
    }

    if (opts.fetchLimit !== undefined && seenUrls.size >= opts.fetchLimit) {
      break
    }
  }

  return htmlPages
}

export const fetchProfilePage = async (
  cacheService: CacheService,
  url: string,
  opts: FetchProfilePageOptions,
): Promise<ProfileFetchOutcome> => {
  const timeoutMs = 20_000
  const userAgent = "1001dj-get-profile/0.1 (educational; contact: none)"
  const profileUrl = url.startsWith("http")
    ? url
    : `${PROFILE_BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`

  try {
    const html = await cacheService.getHTML({
      artifactType: "profile_page",
      request: {
        method: "GET",
        url: profileUrl,
      },
      fetchContent: async () =>
        (
          await httpGetText(
            profileUrl,
            timeoutMs,
            mergeHeaders(
              {
                accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "user-agent": userAgent,
                referer: opts.referer ?? `${PROFILE_BASE_URL}/`,
                "cache-control": "no-cache",
                pragma: "no-cache",
              },
              {},
            ),
            opts.signal,
          )
        ).body,
    })
    return { success: true, target: profileUrl, html }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      target: profileUrl,
      error: {
        code: "PROFILE_FETCH_FAILED",
        provider: "1001dj",
        step: "profile-fetch",
        target: sanitizeForError(profileUrl),
        message: sanitizeForError(message),
      },
    }
  }
}
