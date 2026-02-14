import { describe, expect, it, vi } from "vitest"

import { evaluateProfiles } from "../../src/eval/evaluate-profiles.js"
import type { ServiceProfile } from "../../src/service-types/types.js"

const makeTestProfile = (): ServiceProfile<"wedding-dj"> => ({
  serviceType: "wedding-dj",
  provider: "1001dj",
  providerId: "42",
  name: "DJ Test",
  profileUrl: "https://example.com/dj-test",
  reputation: {
    rating: null,
    reviewCount: null,
    reviewHighlights: [],
  },
  location: {
    city: null,
    region: null,
    serviceArea: [],
    travelPolicy: null,
  },
  availability: {
    availableDates: [],
    leadTimeDays: null,
    bookingStatus: null,
  },
  professionalism: {
    isVerified: null,
    yearsExperience: null,
    responseTime: null,
    contractProvided: null,
    insurance: null,
  },
  media: {
    photosCount: 0,
    videosCount: 0,
    portfolioLinks: [],
  },
  communication: {
    languages: [],
    responseChannels: [],
  },
  policies: {
    cancellationPolicy: null,
    requirements: [],
  },
  budgetSummary: {
    minKnownPrice: null,
    maxKnownPrice: null,
    hasTransparentPricing: false,
    budgetFit: "unknown",
  },
  offers: [],
  serviceSpecific: {
    musicalStyles: [],
    djSetFormats: [],
    mcServices: null,
    soundEquipment: [],
    lightingEquipment: [],
    specialMomentsSupport: [],
  },
})

describe("evaluateProfiles", () => {
  it("emits reason and profile URL in dry-run mode", async () => {
    const profile = makeTestProfile()

    const onProgress = vi.fn()
    const results = await evaluateProfiles({
      profiles: [profile],
      model: "gpt-5-nano",
      reasoningEffort: "low",
      criteriaText: "criteria",
      dryRun: true,
      onProgress,
      apiKey: null,
    })

    expect(results).toHaveLength(1)
    expect(onProgress).toHaveBeenCalledTimes(1)
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "1001dj",
        profileUrl: "https://example.com/dj-test",
        verdict: null,
        reason: "dry-run (no API call)",
      }),
    )
  })
})
