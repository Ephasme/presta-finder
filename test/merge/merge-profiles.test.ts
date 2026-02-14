import { describe, expect, it } from "vitest"

import { mergeProfiles } from "../../src/merge/merge-profiles.js"
import type { ServiceProfile } from "../../src/service-types/types.js"

const makeTestProfile = (
  provider: string,
  providerId: string | null,
  name: string,
  profileUrl: string | null = null,
): ServiceProfile<"wedding-dj"> => ({
  serviceType: "wedding-dj",
  provider,
  providerId,
  name,
  profileUrl,
  reputation: { rating: null, reviewCount: null, reviewHighlights: [] },
  location: { city: null, region: null, serviceArea: [], travelPolicy: null },
  availability: { availableDates: [], leadTimeDays: null, bookingStatus: null },
  professionalism: {
    isVerified: null,
    yearsExperience: null,
    responseTime: null,
    contractProvided: null,
    insurance: null,
  },
  media: { photosCount: 0, videosCount: 0, portfolioLinks: [] },
  communication: { languages: [], responseChannels: [] },
  policies: { cancellationPolicy: null, requirements: [] },
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

describe("merge profiles", () => {
  it("deduplicates profiles by provider + providerId", () => {
    const profileA = makeTestProfile("1001dj", "123", "DJ A")
    const profileB = makeTestProfile("1001dj", "123", "DJ A Duplicate")

    const merged = mergeProfiles([[profileA], [profileB]])

    expect(merged).toHaveLength(1)
    expect(merged[0]?.name).toBe("DJ A")
  })

  it("keeps profiles with different providerIds", () => {
    const profileA = makeTestProfile("1001dj", "123", "DJ A")
    const profileB = makeTestProfile("1001dj", "456", "DJ B")

    const merged = mergeProfiles([[profileA, profileB]])

    expect(merged).toHaveLength(2)
  })

  it("keeps profiles from different providers even with same providerId", () => {
    const profileA = makeTestProfile("1001dj", "123", "DJ A")
    const profileB = makeTestProfile("linkaband", "123", "DJ B")

    const merged = mergeProfiles([[profileA], [profileB]])

    expect(merged).toHaveLength(2)
  })

  it("falls back to profileUrl when providerId is null", () => {
    const profileA = makeTestProfile("1001dj", null, "DJ A", "https://example.com/dj-a")
    const profileB = makeTestProfile("1001dj", null, "DJ A Duplicate", "https://example.com/dj-a")

    const merged = mergeProfiles([[profileA], [profileB]])

    expect(merged).toHaveLength(1)
    expect(merged[0]?.name).toBe("DJ A")
  })

  it("keeps both profiles when providerId and profileUrl are both null (UUID fallback)", () => {
    const profileA = makeTestProfile("1001dj", null, "DJ A", null)
    const profileB = makeTestProfile("1001dj", null, "DJ B", null)

    const merged = mergeProfiles([[profileA], [profileB]])

    // UUID fallback means no deduplication
    expect(merged).toHaveLength(2)
  })

  it("merges profiles from multiple provider arrays", () => {
    const provider1Profiles = [
      makeTestProfile("1001dj", "1", "DJ 1"),
      makeTestProfile("1001dj", "2", "DJ 2"),
    ]
    const provider2Profiles = [makeTestProfile("linkaband", "10", "DJ 3")]
    const provider3Profiles = [makeTestProfile("livetonight", "20", "DJ 4")]

    const merged = mergeProfiles([provider1Profiles, provider2Profiles, provider3Profiles])

    expect(merged).toHaveLength(4)
  })
})
