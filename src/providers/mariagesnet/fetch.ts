import { writeFile } from "node:fs/promises"

import pLimit from "p-limit"
import { sleep } from "../../utils/sleep.js"
import { throwIfAborted } from "../../utils/cancel.js"
import { httpPostJson, mergeHeaders } from "../../utils/http.js"
import type { ResultItem } from "../../schema/normalized.js"
import { SCHEMA_VERSION, type ParsedOutput, validateParsedOutput } from "../../schema/validate.js"
import { buildUrl } from "../../utils/url.js"
import { paginateUntil } from "../../utils/paginate.js"
import { parseMariagesnet } from "./parse.js"
import { parseMariagesnetProfilePage } from "./parse-profile.js"

export const DEFAULT_ENDPOINT = "https://www.mariages.net/search-filters.php"
export const BRIGHTDATA_API_ENDPOINT = "https://api.brightdata.com/request"

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
    query["faqs[]"] = params.faqs.map((faq) => String(faq))
  }
  if (params.popularPriceRange) {
    const [lo, hi] = params.popularPriceRange
    query["popularPriceRange[]"] = [`[${lo},${hi}]`]
  }
  return query
}

export const fetchAndParseMariagesnet = async (args: {
  outputFile: string
  dryRun: boolean
  brightdataApiKey: string | null
  brightdataZone: string | null
  endpoint?: string
  timeoutMs?: number
  fetchLimit?: number
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
  const timeoutMs = args.timeoutMs ?? 15_000
  const profileDelayMs = args.profileDelayMs ?? 30
  const concurrency = args.profileConcurrency === false ? 1 : 4

  log?.("mariagesnet", "fetching profile list…")
  const result = await getProfilesMariagesnet({
    brightdataApiKey: args.brightdataApiKey,
    brightdataZone: args.brightdataZone,
    endpoint: args.endpoint,
    timeoutMs,
    fetchLimit: args.fetchLimit,
    onFetchProgress: args.onFetchProgress,
    signal: args.signal,
  })

  log?.("mariagesnet", `profile list done (${result.meta.count} profiles)`)
  let profilePagesFetched = 0
  let profilePagesFailed = 0
  const profileItems = result.results.filter((item) => item.kind === "profile" && Boolean(item.normalized.url))
  const totalProfileItems = profileItems.length
  let processedProfileItems = 0
  log?.("mariagesnet", `starting profile pages (${totalProfileItems} pages, concurrency=${concurrency})`)
  args.onFetchProgress?.(0, totalProfileItems)
  const limit = pLimit(concurrency)
  await Promise.all(
    profileItems.map((item) =>
      limit(async () => {
        const profileUrl = item.normalized.url
        if (!profileUrl) {
          return
        }
        try {
          const page = await getProfileMariagesnet({
            brightdataApiKey: args.brightdataApiKey,
            brightdataZone: args.brightdataZone,
            profileUrl,
            timeoutMs,
            signal: args.signal,
          })
          item.normalized.description = item.normalized.description ?? page.description
          if (page.ratingValue !== null) {
            // Profile header rating is more reliable than listing snippets.
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
  log?.("mariagesnet", `profile pages done (fetched=${profilePagesFetched}, failed=${profilePagesFailed})`)
  result.meta.profilePagesFetched = profilePagesFetched
  result.meta.profilePagesFailed = profilePagesFailed

  log?.("mariagesnet", "writing output file")
  await writeFile(args.outputFile, `${JSON.stringify(result, null, 2)}\n`, "utf-8")
  return result.meta.count
}

const ensureBrightDataConfig = (apiKey: string | null, zone: string | null): { apiKey: string; zone: string } => {
  if (!apiKey || !zone) {
    throw new Error("BRIGHTDATA_API_KEY and BRIGHTDATA_WEB_UNLOCKER_ZONE are required for Mariages.net")
  }
  return { apiKey, zone }
}

const brightdataGet = async (args: {
  url: string
  apiKey: string
  zone: string
  timeoutMs: number
  signal?: AbortSignal
}): Promise<unknown> =>
  (
    await httpPostJson<unknown>(
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

const extractRawHtml = (payload: unknown): string | null => {
  if (typeof payload === "string") {
    return payload
  }
  if (!payload || typeof payload !== "object") {
    return null
  }
  const record = payload as Record<string, unknown>
  const directBody = record.body
  if (typeof directBody === "string") {
    return directBody
  }
  const data = record.data
  if (typeof data === "string") {
    return data
  }
  return null
}

export const getProfilesMariagesnet = async (args: {
  brightdataApiKey: string | null
  brightdataZone: string | null
  endpoint?: string
  timeoutMs?: number
  fetchLimit?: number
  maxPages?: number
  sleepBetweenMs?: number
  onFetchProgress?: (current: number, total: number, status?: string) => void
  signal?: AbortSignal
}): Promise<ParsedOutput> => {
  const config = ensureBrightDataConfig(args.brightdataApiKey, args.brightdataZone)
  const endpoint = args.endpoint ?? DEFAULT_ENDPOINT
  const timeoutMs = args.timeoutMs ?? 15_000

  const allResults: ResultItem[] = []
  const seenVendorIds = new Set<string>()
  const maxPages = args.maxPages ?? 50

  for await (const { page, items } of paginateUntil<ResultItem>({
    fetchPage: async (pageNum) => {
      const targetUrl = buildUrl(
        endpoint,
        toQueryParams({
          idGrupo: 2,
          idSector: 9,
          isHomeSearcher: 1,
          numPage: pageNum,
          showmode: "list",
          userSearch: 1,
          isNearby: 1,
        }),
      )
      const payload = await brightdataGet({
        url: targetUrl,
        apiKey: config.apiKey,
        zone: config.zone,
        timeoutMs,
        signal: args.signal,
      })
      const parsed = parseMariagesnet(payload)
      return parsed.results.filter((r) => r.kind === "profile")
    },
    firstPage: 1,
    sleepBetweenMs: args.sleepBetweenMs ?? 500,
    maxPages,
    signal: args.signal,
  })) {
    if (items.length === 0) {
      break
    }
    for (const item of items) {
      if (args.fetchLimit !== undefined && allResults.length >= args.fetchLimit) {
        break
      }
      const vendorId = String(item.normalized.id ?? item.normalized.url ?? item.normalized.slug)
      if (seenVendorIds.has(vendorId)) {
        continue
      }
      seenVendorIds.add(vendorId)
      allResults.push(item)
    }
    args.onFetchProgress?.(page, maxPages, `listing — ${allResults.length} profiles`)
    if (args.fetchLimit !== undefined && allResults.length >= args.fetchLimit) {
      break
    }
  }

  return validateParsedOutput({
    meta: {
      website: "mariagesnet",
      kind: "profiles",
      count: allResults.length,
      generatedAt: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
    },
    results: allResults,
    raw: null,
  })
}

export const getProfileMariagesnet = async (args: {
  brightdataApiKey: string | null
  brightdataZone: string | null
  profileUrl: string
  timeoutMs?: number
  signal?: AbortSignal
}) => {
  const config = ensureBrightDataConfig(args.brightdataApiKey, args.brightdataZone)
  const timeoutMs = args.timeoutMs ?? 15_000
  const payload = await brightdataGet({
    url: args.profileUrl,
    apiKey: config.apiKey,
    zone: config.zone,
    timeoutMs,
    signal: args.signal,
  })
  const html = extractRawHtml(payload)
  if (!html) {
    throw new Error("Mariages.net profile page HTML not found in Bright Data response")
  }
  return parseMariagesnetProfilePage(html)
}
