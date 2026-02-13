import { describe, expect, it } from "vitest"

import { makeNormalizedResult, normalizedProfileSchema } from "../../src/schema/normalized.js"

describe("normalized schema", () => {
  it("accepts defaulted normalized result", () => {
    const profile = makeNormalizedResult({
      website: "test",
      kind: "profile",
      sourceId: 1,
      name: "Test DJ",
    })
    const parsed = normalizedProfileSchema.safeParse(profile)
    expect(parsed.success).toBe(true)
  })
})
