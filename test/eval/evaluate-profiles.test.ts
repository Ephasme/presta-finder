import { describe, expect, it, vi } from "vitest"

import { evaluateProfiles } from "../../src/eval/evaluate-profiles.js"
import { makeNormalizedResult } from "../../src/schema/normalized.js"

describe("evaluateProfiles", () => {
  it("emits reason and profile URL in dry-run mode", async () => {
    const profile = makeNormalizedResult({
      website: "example",
      kind: "profile",
      sourceId: 42,
      name: "DJ Test",
      url: "https://example.com/dj-test",
    })

    const onProgress = vi.fn()
    const results = await evaluateProfiles({
      profiles: [profile],
      model: "gpt-4o",
      criteriaText: "criteria",
      budgetTarget: 1000,
      budgetMax: 1300,
      sleepMs: 0,
      dryRun: true,
      onProgress,
      apiKey: null,
    })

    expect(results).toHaveLength(1)
    expect(onProgress).toHaveBeenCalledTimes(1)
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        profileUrl: "https://example.com/dj-test",
        verdict: null,
        reason: "dry-run (no API call)",
      }),
    )
  })
})
