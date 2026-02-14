import { z } from "zod"

import { SCHEMA_VERSION, type ParsedOutput, validateParsedOutput } from "../../schema/validate.js"
import { isRecord } from "../../utils/type-guards.js"
import {
  buildAggregationItem,
  buildProfileItem,
  parseAggregations,
  parseUser,
  type UserProfile,
} from "./normalize.js"

const searchValuesSchema = z
  .object({
    date: z.string().optional(),
    address: z.string().optional(),
    lat: z.union([z.number(), z.string()]).optional(),
    lng: z.union([z.number(), z.string()]).optional(),
    categories: z.array(z.string()).optional(),
    types: z.array(z.string()).optional(),
    titles: z.array(z.string()).optional(),
    page: z.number().optional(),
    budget: z.union([z.tuple([z.number(), z.number()]), z.null()]).optional(),
    sortedBy: z.string().optional(),
    radius: z.number().optional(),
    term: z.string().optional(),
    timestamp: z.number().optional(),
    index: z.string().optional(),
    onboarding: z.array(z.string()).optional(),
    users: z.array(z.string()).optional(),
    dj: z.array(z.string()).optional(),
  })
  .loose()

const elasticShardsSchema = z
  .object({
    total: z.number(),
    successful: z.number(),
    skipped: z.number(),
    failed: z.number(),
  })
  .loose()

const elasticHitTotalSchema = z
  .object({
    value: z.number(),
    relation: z.string(),
  })
  .loose()

const elasticHitSchema = z
  .object({
    _index: z.string(),
    _type: z.string(),
    _id: z.string(),
    _score: z.number().nullable(),
    _source: z.record(z.string(), z.unknown()).optional(),
    sort: z.array(z.number()).optional(),
  })
  .loose()

const livetonightSearchResponseSchema = z
  .object({
    final: z
      .object({
        body: z
          .object({
            took: z.number().optional(),
            timed_out: z.boolean().optional(),
            _shards: elasticShardsSchema.optional(),
            hits: z
              .object({
                total: elasticHitTotalSchema.optional(),
                max_score: z.number().nullable().optional(),
                hits: z.array(elasticHitSchema),
              })
              .loose(),
          })
          .loose(),
        values: searchValuesSchema.optional(),
        query: z.record(z.string(), z.string()).optional(),
        aggregations: z.union([z.boolean(), z.record(z.string(), z.unknown())]).optional(),
        bodyTitles: z.unknown().nullable().optional(),
        resultCountToShow: z.number().optional(),
      })
      .loose(),
  })
  .loose()

type ParsedSearchResponse = z.infer<typeof livetonightSearchResponseSchema>

const parseSearchResponse = (obj: Record<string, unknown>): ParsedSearchResponse | null => {
  const parsed = livetonightSearchResponseSchema.safeParse(obj)
  return parsed.success ? parsed.data : null
}

const extractUsersProfiles = (response: ParsedSearchResponse): Record<string, unknown>[] => {
  const hitList = response.final.body.hits.hits
  const out: Record<string, unknown>[] = []
  for (const entry of hitList) {
    const source = entry._source
    if (source && typeof source === "object" && !Array.isArray(source)) {
      out.push(source)
    }
  }
  return out
}

export const parseLiveTonightListingResponse = (jsonContent: string): UserProfile[] => {
  let input: unknown
  try {
    input = JSON.parse(jsonContent)
  } catch {
    return []
  }

  if (!isRecord(input)) {
    return []
  }

  const response = parseSearchResponse(input)
  if (!response) {
    return []
  }

  const profiles = extractUsersProfiles(response)
  const users = profiles.flatMap((profile) => {
    try {
      return [parseUser(profile)]
    } catch {
      return []
    }
  })

  return users
}

const parseUnknown = (): ParsedOutput =>
  validateParsedOutput({
    meta: {
      website: "livetonight",
      kind: "unknown",
      count: 0,
      generatedAt: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
    },
    results: [],
    raw: null,
  })

export const parseLiveTonight = (input: unknown): ParsedOutput => {
  if (!isRecord(input)) {
    return parseUnknown()
  }

  const response = parseSearchResponse(input)
  if (!response) {
    return parseUnknown()
  }

  const { final } = response
  const profiles = extractUsersProfiles(response)

  if (profiles.length > 0) {
    const users = profiles.flatMap((profile) => {
      try {
        return [parseUser(profile)]
      } catch {
        return []
      }
    })
    const total = final.body.hits.total?.value ?? null
    const values = final.values ?? null

    return validateParsedOutput({
      meta: {
        website: "livetonight",
        kind: "profiles",
        count: users.length,
        totalHits: total,
        values,
        generatedAt: new Date().toISOString(),
        schemaVersion: SCHEMA_VERSION,
      },
      results: users.map(buildProfileItem),
      raw: null,
    })
  }

  const { aggregations } = final
  if (typeof aggregations === "object") {
    const values = final.values ?? null
    const agg = parseAggregations(
      "musicians_aggregations",
      aggregations,
      isRecord(values) ? values : null,
    )
    return validateParsedOutput({
      meta: {
        website: "livetonight",
        kind: "aggregations",
        count: 1,
        values,
        generatedAt: new Date().toISOString(),
        schemaVersion: SCHEMA_VERSION,
      },
      results: [buildAggregationItem(agg)],
      raw: null,
    })
  }

  return parseUnknown()
}
