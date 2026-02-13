import { z } from "zod"

import { jsonValueSchema, normalizedProfileSchema, resultItemSchema, type NormalizedProfile } from "./normalized.js"

export const SCHEMA_VERSION = "2.0"

export const parsedOutputSchema = z.object({
  meta: z
    .object({
      website: z.string().min(1),
      kind: z.enum(["profiles", "aggregations", "unknown"]),
      count: z.number().int().nonnegative(),
      generatedAt: z.string().datetime(),
      schemaVersion: z.literal(SCHEMA_VERSION),
    })
    .passthrough(),
  results: z.array(resultItemSchema),
  raw: jsonValueSchema,
})

export type ParsedOutput = z.infer<typeof parsedOutputSchema>

export const validateParsedOutput = (value: unknown): ParsedOutput => {
  const parsed = parsedOutputSchema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue?.path.length ? issue.path.join(".") : "$"
    throw new Error(`Invalid parsed output: ${issue?.message ?? "unknown error"} (path: ${path})`)
  }
  return parsed.data
}

export const extractProfilesFromResults = (value: unknown): NormalizedProfile[] => {
  if (!value || typeof value !== "object") {
    return []
  }
  const maybeObj = value as Record<string, unknown>

  if (Array.isArray(maybeObj.results)) {
    const profiles: NormalizedProfile[] = []
    for (const item of maybeObj.results) {
      if (!item || typeof item !== "object") {
        continue
      }
      const typedItem = item as Record<string, unknown>
      if (typedItem.kind !== "profile") {
        continue
      }
      const parsedProfile = normalizedProfileSchema.safeParse(typedItem.normalized)
      if (parsedProfile.success) {
        profiles.push(parsedProfile.data)
      }
    }
    return profiles
  }

  if (Array.isArray(maybeObj.profiles)) {
    const profiles: NormalizedProfile[] = []
    for (const item of maybeObj.profiles) {
      if (!item || typeof item !== "object") {
        continue
      }
      const typedItem = item as Record<string, unknown>
      const normalized = typedItem.normalized && typeof typedItem.normalized === "object" ? typedItem.normalized : typedItem
      const parsedProfile = normalizedProfileSchema.safeParse(normalized)
      if (parsedProfile.success) {
        profiles.push(parsedProfile.data)
      }
    }
    return profiles
  }

  return []
}
