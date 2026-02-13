import { describe, expect, it } from "vitest"

import { makeNormalizedResult } from "../../src/schema/normalized.js"
import { buildProfilePayload } from "../../src/eval/build-payload.js"

describe("build profile payload", () => {
  it("builds payload with computed signals", () => {
    const profile = makeNormalizedResult({
      website: "test",
      kind: "profile",
      sourceId: 1,
      name: "DJ",
      description: "Description",
      pricing: {
        min: 900,
        max: 1200,
        raw: null,
        currency: "EUR",
      },
    })
    const payload = buildProfilePayload(profile, 1000, 1300)
    expect(payload.signals.has_price).toBe(true)
    expect(payload.signals.price_min).toBe(900)
    expect(payload.budget.target_eur).toBe(1000)
  })
})
