import { z } from "zod"

import { jsonValueSchema, resultItemSchema } from "./normalized.js"

export const SCHEMA_VERSION = "2.0"

export const parsedOutputSchema = z.object({
  meta: z
    .object({
      website: z.string().min(1),
      kind: z.enum(["profiles", "aggregations", "unknown"]),
      count: z.number().int().nonnegative(),
      generatedAt: z.iso.datetime(),
      schemaVersion: z.literal(SCHEMA_VERSION),
    })
    .loose(),
  results: z.array(resultItemSchema),
  raw: jsonValueSchema,
})

export type ParsedOutput = z.infer<typeof parsedOutputSchema>

export const validateParsedOutput = (value: unknown): ParsedOutput => {
  const parsed = parsedOutputSchema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue.path.length ? issue.path.join(".") : "$"
    throw new Error(`Invalid parsed output: ${issue.message} (path: ${path})`)
  }
  return parsed.data
}
