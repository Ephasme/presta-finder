import { httpPostText, mergeHeaders } from "../../utils/http.js"
import { isRecord } from "../../utils/type-guards.js"
import { buildUrl } from "../../utils/url.js"
import { paginateUntil } from "../../utils/paginate.js"
import type { CacheService } from "../cache-service.js"
import type { ProfileFetchOutcome, VerboseLog } from "../types.js"
import { sanitizeForError } from "../types.js"

export const DEFAULT_ENDPOINT = "https://www.mariages.net/search-filters.php"
export const BRIGHTDATA_API_ENDPOINT = "https://api.brightdata.com/request"

interface FetchListingPagesOptions {
  fetchLimit?: number
  signal?: AbortSignal
  verbose?: VerboseLog
}

interface FetchProfilePageOptions {
  signal?: AbortSignal
}

interface BrightDataConfig {
  apiKey: string
  zone: string
}

interface BrightDataGetArgs {
  url: string
  apiKey: string
  zone: string
  timeoutMs: number
  signal?: AbortSignal
}

interface BrightDataRequestBody {
  zone: string | null
  url: string
  format: "raw"
  method: "GET"
}

const parseJsonContent = (content: string, context: string): unknown => {
  try {
    return JSON.parse(content)
  } catch {
    throw new Error(`Invalid JSON artifact payload for ${context}`)
  }
}

export interface SearchParams {
  idGrupo: number
  idSector: number
  idRegion?: number
  idProvincia?: number
  txtStrSearch?: string
  txtLocSearch?: string
  isHomeSearcher?: number
  numPage?: number
  showmode?: string
  userSearch?: number
  isNearby?: number
  faqs?: string[]
  popularPriceRange?: [number, number]
}

const toQueryParams = (params: SearchParams): Record<string, string | string[]> => {
  const query: Record<string, string | string[]> = {
    id_grupo: String(params.idGrupo),
    id_sector: String(params.idSector),
    id_region: params.idRegion !== undefined ? String(params.idRegion) : "",
    id_provincia: params.idProvincia !== undefined ? String(params.idProvincia) : "",
    showmode: params.showmode ?? "list",
    NumPage: String(params.numPage ?? 1),
    isHomeSearcher: String(params.isHomeSearcher ?? 1),
    txtStrSearch: params.txtStrSearch ?? "",
    txtLocSearch: params.txtLocSearch ?? "",
    userSearch: String(params.userSearch ?? 1),
    isNearby: String(params.isNearby ?? 1),
  }
  if (params.faqs?.length) {
    query["faqs[]"] = params.faqs
  }
  if (params.popularPriceRange) {
    const [lo, hi] = params.popularPriceRange
    query["popularPriceRange[]"] = [`[${lo},${hi}]`]
  }
  return query
}

export const fetchListingPages = async (
  cacheService: CacheService,
  idGrupo: number,
  idSector: number,
  brightdataApiKey: string | null,
  brightdataZone: string | null,
  opts: FetchListingPagesOptions,
): Promise<unknown[]> => {
  const config = ensureBrightDataConfig(brightdataApiKey, brightdataZone)
  const endpoint = DEFAULT_ENDPOINT
  const timeoutMs = 15_000
  const log = (message: string): void => {
    opts.verbose?.("mariagesnet", message)
  }

  const rawListingResponses: unknown[] = []
  const seenVendorIds = new Set<string>()
  const maxPages = 50
  let totalVendorCount = 0

  log(
    `listing fetch start (idGrupo=${idGrupo}, idSector=${idSector}, fetchLimit=${opts.fetchLimit ?? "none"}, maxPages=${maxPages})`,
  )

  for await (const { items } of paginateUntil<unknown>({
    fetchPage: async (pageNum) => {
      const targetUrl = buildUrl(
        endpoint,
        toQueryParams({
          idGrupo,
          idSector,
          isHomeSearcher: 1,
          numPage: pageNum,
          showmode: "list",
          userSearch: 1,
          isNearby: 1,
        }),
      )
      log(`listing page fetch start (page=${pageNum})`)
      const pageStart = Date.now()
      const payloadContent = await cacheService.getOrFetchArtifact({
        artifactType: "listing_response",
        request: {
          method: "POST",
          url: BRIGHTDATA_API_ENDPOINT,
          body: buildBrightDataRequestBody(config.zone, targetUrl),
        },
        fetchContent: async () =>
          brightdataGet({
            url: targetUrl,
            apiKey: config.apiKey,
            zone: config.zone,
            timeoutMs,
            signal: opts.signal,
          }),
      })
      log(
        `listing page fetch done (page=${pageNum}, bytes=${payloadContent.length}, elapsedMs=${Date.now() - pageStart})`,
      )
      const payload = parseJsonContent(payloadContent, targetUrl)
      return [payload]
    },
    firstPage: 1,
    sleepBetweenMs: 500,
    maxPages,
    signal: opts.signal,
  })) {
    if (items.length === 0) {
      log("listing fetch received empty page, stopping")
      break
    }

    const beforeCount = totalVendorCount
    for (const payload of items) {
      rawListingResponses.push(payload)
      // Count unique vendors for progress reporting
      const vendorIds = extractVendorIdsFromPayload(payload)
      if (vendorIds.length > 0) {
        for (const vendorId of vendorIds) {
          if (!seenVendorIds.has(vendorId)) {
            seenVendorIds.add(vendorId)
            totalVendorCount += 1
          }
        }
      }
    }
    if (totalVendorCount !== beforeCount) {
      log(
        `listing page processed (payloads=${items.length}, vendorsAdded=${totalVendorCount - beforeCount}, totalVendors=${totalVendorCount})`,
      )
    }

    if (opts.fetchLimit !== undefined && totalVendorCount >= opts.fetchLimit) {
      log(`listing fetch reached fetchLimit (${opts.fetchLimit})`)
      break
    }
  }

  log(`listing fetch done (responses=${rawListingResponses.length}, vendors=${totalVendorCount})`)
  return rawListingResponses
}

const ensureBrightDataConfig = (apiKey: string | null, zone: string | null): BrightDataConfig => {
  if (!apiKey || !zone) {
    throw new Error(
      "BRIGHTDATA_API_KEY and BRIGHTDATA_WEB_UNLOCKER_ZONE are required for Mariages.net",
    )
  }
  return { apiKey, zone }
}

const brightdataGet = async (args: BrightDataGetArgs): Promise<string> =>
  (
    await httpPostText(
      BRIGHTDATA_API_ENDPOINT,
      {
        zone: args.zone,
        url: args.url,
        format: "raw",
        method: "GET",
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "user-agent": "mariagesnet-get-profiles/0.1 (educational; contact: none)",
        },
      },
      args.timeoutMs,
      mergeHeaders(
        {
          authorization: `Bearer ${args.apiKey}`,
        },
        {},
      ),
      args.signal,
    )
  ).body

const buildBrightDataRequestBody = (
  zone: string | null,
  targetUrl: string,
): BrightDataRequestBody => ({
  zone,
  url: targetUrl,
  format: "raw",
  method: "GET",
})

const extractRawHtml = (payload: unknown): string | null => {
  if (typeof payload === "string") {
    return payload
  }
  if (!isRecord(payload)) {
    return null
  }
  const directBody = payload.body
  if (typeof directBody === "string") {
    return directBody
  }
  const data = payload.data
  if (typeof data === "string") {
    return data
  }
  return null
}

const extractListingHtml = (payload: unknown): string | null => {
  const raw = extractRawHtml(payload)
  if (raw) {
    return raw
  }
  if (!isRecord(payload)) {
    return null
  }
  const listingResults = payload.listingResults
  if (typeof listingResults === "string") {
    return listingResults
  }
  const data = payload.data
  if (isRecord(data) && typeof data.listingResults === "string") {
    return data.listingResults
  }
  return null
}

const extractVendorIdsFromPayload = (payload: unknown): string[] => {
  if (isRecord(payload)) {
    const rawIds = payload.resultVendorsIds
    if (Array.isArray(rawIds)) {
      return rawIds
        .map((value) => (value === null || value === undefined ? null : String(value)))
        .filter((value): value is string => Boolean(value))
    }
  }
  const html = extractListingHtml(payload)
  if (!html) {
    return []
  }
  const ids: string[] = []
  const vendorIdMatches = html.matchAll(/data-vendor-id="(\d+)"/g)
  for (const match of vendorIdMatches) {
    const vendorId = match[1]
    if (vendorId) {
      ids.push(vendorId)
    }
  }
  return ids
}

export const fetchProfilePage = async (
  cacheService: CacheService,
  profileUrl: string,
  brightdataApiKey: string | null,
  brightdataZone: string | null,
  opts: FetchProfilePageOptions,
): Promise<ProfileFetchOutcome> => {
  const config = ensureBrightDataConfig(brightdataApiKey, brightdataZone)
  const timeoutMs = 15_000

  try {
    const payloadContent = await cacheService.getOrFetchArtifact({
      artifactType: "profile_response",
      request: {
        method: "POST",
        url: BRIGHTDATA_API_ENDPOINT,
        body: buildBrightDataRequestBody(config.zone, profileUrl),
      },
      fetchContent: async () =>
        brightdataGet({
          url: profileUrl,
          apiKey: config.apiKey,
          zone: config.zone,
          timeoutMs,
          signal: opts.signal,
        }),
    })
    if (!payloadContent) {
      throw new Error("Empty response from Bright Data")
    }
    return { success: true, target: profileUrl, html: payloadContent }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      target: profileUrl,
      error: {
        code: "PROFILE_FETCH_FAILED",
        provider: "mariagesnet",
        step: "profile-fetch",
        target: sanitizeForError(profileUrl),
        message: sanitizeForError(message),
      },
    }
  }
}
