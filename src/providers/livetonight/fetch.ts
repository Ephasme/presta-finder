import { writeFile } from "node:fs/promises"

import pLimit from "p-limit"
import { sleep } from "../../utils/sleep.js"
import { throwIfAborted } from "../../utils/cancel.js"
import { httpGetJson, httpGetText, mergeHeaders } from "../../utils/http.js"
import type { ResultItem } from "../../schema/normalized.js"
import { SCHEMA_VERSION, type ParsedOutput, validateParsedOutput } from "../../schema/validate.js"
import { buildUrl } from "../../utils/url.js"
import { paginateUntil } from "../../utils/paginate.js"
import { parseLiveTonight } from "./parse.js"
import { parseLiveTonightProfilePage } from "./parse-profile.js"

export const DEFAULT_ENDPOINT = "https://wasmv8e0b5.execute-api.eu-west-3.amazonaws.com/default/searchMusiciansv2"
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

const commaList = (values: string[] | undefined): string | undefined => {
  if (!values?.length) {
    return undefined
  }
  const cleaned = values.map((value) => value.trim()).filter(Boolean)
  return cleaned.length ? cleaned.join(",") : undefined
}

const budgetPair = (budget: [number, number] | undefined): string | undefined => {
  if (!budget) {
    return undefined
  }
  const [lo, hi] = budget
  if (lo < 0 || hi < 0 || lo > hi) {
    throw new Error("budget must be non-negative and min<=max")
  }
  return `${lo},${hi}`
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
  const budget = budgetPair(params.budget)
  if (budget) query.budget = budget
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

export const fetchAndParseLiveTonight = async (args: {
  outputFile: string
  dryRun: boolean
  categories: string[]
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

  log?.("livetonight", "fetching profile list…")
  const result = await getProfilesLiveTonight({
    categories: args.categories,
    endpoint: args.endpoint,
    timeoutMs,
    fetchLimit: args.fetchLimit,
    onFetchProgress: args.onFetchProgress,
    signal: args.signal,
  })

  log?.("livetonight", `profile list done (${result.meta.count} profiles)`)
  let profilePagesFetched = 0
  let profilePagesFailed = 0
  const profileItems = result.results.filter(
    (item) => item.kind === "profile" && Boolean(item.normalized.slug) && typeof item.normalized.id === "number",
  )
  const totalProfileItems = profileItems.length
  let processedProfileItems = 0
  log?.("livetonight", `starting profile pages (${totalProfileItems} pages, concurrency=${concurrency})`)
  args.onFetchProgress?.(0, totalProfileItems)
  const limit = pLimit(concurrency)
  await Promise.all(
    profileItems.map((item) =>
      limit(async () => {
        const slug = item.normalized.slug
        const sourceId = typeof item.normalized.id === "number" ? item.normalized.id : null
        if (!slug || sourceId === null) {
          return
        }
        try {
          const page = await getProfileLiveTonight({
            profileId: sourceId,
            slug,
            timeoutMs,
            signal: args.signal,
          })
          item.normalized.description = item.normalized.description ?? page.description
          if (page.ratingValue !== null) {
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
  log?.("livetonight", `profile pages done (fetched=${profilePagesFetched}, failed=${profilePagesFailed})`)
  result.meta.profilePagesFetched = profilePagesFetched
  result.meta.profilePagesFailed = profilePagesFailed

  log?.("livetonight", "writing output file")
  await writeFile(args.outputFile, `${JSON.stringify(result, null, 2)}\n`, "utf-8")
  return result.meta.count
}

export const getProfilesLiveTonight = async (args: {
  categories: string[]
  endpoint?: string
  timeoutMs?: number
  fetchLimit?: number
  maxPages?: number
  sleepBetweenMs?: number
  onFetchProgress?: (current: number, total: number, status?: string) => void
  signal?: AbortSignal
}): Promise<ParsedOutput> => {
  const endpoint = args.endpoint ?? DEFAULT_ENDPOINT
  const timeoutMs = args.timeoutMs ?? 15_000

  const allResults: ResultItem[] = []
  const seenSlugs = new Set<string>()
  const maxPages = args.maxPages ?? 50

  for await (const { page, items } of paginateUntil<ResultItem>({
    fetchPage: async (pageNum) => {
      const url = buildUrl(
        endpoint,
        toQueryParams({
          index: "users",
          page: pageNum,
          radius: 50,
          sortedBy: "pertinence",
          categories: args.categories,
          dj: "dj-wedding",
        }),
      )
      const response = await httpGetJson<unknown>(
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
        args.signal,
      )
      const parsed = parseLiveTonight(response.body)
      return parsed.results.filter((r) => r.kind === "profile")
    },
    firstPage: 1,
    sleepBetweenMs: args.sleepBetweenMs ?? 100,
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
      const key = item.normalized.slug ?? item.normalized.url ?? String(item.normalized.id)
      if (seenSlugs.has(key)) {
        continue
      }
      seenSlugs.add(key)
      allResults.push(item)
    }
    args.onFetchProgress?.(page, maxPages, `listing — ${allResults.length} profiles`)
    if (args.fetchLimit !== undefined && allResults.length >= args.fetchLimit) {
      break
    }
  }

  return validateParsedOutput({
    meta: {
      website: "livetonight",
      kind: allResults.length > 0 ? "profiles" : "unknown",
      count: allResults.length,
      generatedAt: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
    },
    results: allResults,
    raw: null,
  })
}

export const getProfileLiveTonight = async (args: {
  profileId: number
  slug: string
  timeoutMs?: number
  signal?: AbortSignal
}) => {
  const timeoutMs = args.timeoutMs ?? 15_000
  const url = `${LIVETONIGHT_PROFILE_BASE_URL}/groupe-musique-dj/${args.profileId}-${args.slug}`
  const response = await httpGetText(
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
    args.signal,
  )
  return parseLiveTonightProfilePage(response.body)
}
