import { SCHEMA_VERSION, type ParsedOutput, validateParsedOutput } from "../../schema/validate.js"
import { buildAggregationItem, buildProfileItem, parseAggregations, parseUser } from "./normalize.js"

const extractUsersProfiles = (obj: Record<string, unknown>): Record<string, unknown>[] => {
  const final = obj.final
  if (!final || typeof final !== "object") {
    return []
  }
  const body = (final as Record<string, unknown>).body
  if (!body || typeof body !== "object") {
    return []
  }
  const hits = (body as Record<string, unknown>).hits
  if (!hits || typeof hits !== "object") {
    return []
  }
  const hitList = (hits as Record<string, unknown>).hits
  if (!Array.isArray(hitList)) {
    return []
  }
  const out: Record<string, unknown>[] = []
  for (const entry of hitList) {
    if (!entry || typeof entry !== "object") {
      continue
    }
    const source = (entry as Record<string, unknown>)._source
    if (source && typeof source === "object") {
      out.push(source as Record<string, unknown>)
    }
  }
  return out
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
  if (!input || typeof input !== "object") {
    return parseUnknown()
  }
  const obj = input as Record<string, unknown>
  const final = obj.final
  if (!final || typeof final !== "object") {
    return parseUnknown()
  }
  const finalRecord = final as Record<string, unknown>

  const profiles = extractUsersProfiles(obj)
  if (profiles.length > 0) {
    const users = profiles.flatMap((profile) => {
      try {
        return [parseUser(profile)]
      } catch {
        return []
      }
    })
    const body = finalRecord.body && typeof finalRecord.body === "object" ? (finalRecord.body as Record<string, unknown>) : {}
    const hits = body.hits && typeof body.hits === "object" ? (body.hits as Record<string, unknown>) : {}
    const total = hits.total && typeof hits.total === "object" ? (hits.total as Record<string, unknown>).value : null
    const values =
      finalRecord.values && typeof finalRecord.values === "object"
        ? (finalRecord.values as Record<string, unknown>)
        : null

    return validateParsedOutput({
      meta: {
        website: "livetonight",
        kind: "profiles",
        count: users.length,
        totalHits: typeof total === "number" ? total : null,
        values,
        generatedAt: new Date().toISOString(),
        schemaVersion: SCHEMA_VERSION,
      },
      results: users.map(buildProfileItem),
      raw: null,
    })
  }

  if (finalRecord.aggregations && typeof finalRecord.aggregations === "object") {
    const values =
      finalRecord.values && typeof finalRecord.values === "object"
        ? (finalRecord.values as Record<string, unknown>)
        : null
    const agg = parseAggregations(
      "musicians_aggregations",
      finalRecord.aggregations as Record<string, unknown>,
      values,
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
