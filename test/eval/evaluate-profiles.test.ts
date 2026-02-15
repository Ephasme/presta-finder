import { describe, expect, it } from "vitest"

import { evaluateOneProfile } from "../../src/eval/evaluate-profiles.js"
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

describe("evaluateOneProfile", () => {
  it("returns dry-run result when dryRun is true", async () => {
    const profile = makeTestProfile()

    const result = await evaluateOneProfile({
      profile,
      client: null,
      model: "gpt-5-nano",
      reasoningEffort: "low",
      criteriaText: "criteria",
      dryRun: true,
    })

    expect(result.profile).toBe(profile)
    expect(result.evaluation).toBeNull()
    expect(result.error).toBe("dry-run (no API call)")
    expect(result.rawOutput).toBeNull()
  })

  // TODO: Add tests for actual API calls with mocked OpenAI client
  // TODO: Add tests for refusal handling
  // TODO: Add tests for API error handling
})
