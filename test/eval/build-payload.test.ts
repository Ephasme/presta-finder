import { describe, expect, it } from "vitest"

import { buildProfilePayload } from "../../src/eval/build-payload.js"
import type { ServiceProfile } from "../../src/service-types/types.js"

const makeTestProfile = (
  overrides: Partial<ServiceProfile<"wedding-dj">> = {},
): ServiceProfile<"wedding-dj"> => ({
  serviceType: "wedding-dj",
  provider: "linkaband",
  providerId: "123",
  name: "DJ Test",
  profileUrl: "https://example.com/dj",
  reputation: {
    rating: 4.5,
    reviewCount: 10,
    reviewHighlights: [],
  },
  location: {
    city: "Paris",
    region: "Île-de-France",
    serviceArea: ["Paris"],
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
    photosCount: 1,
    videosCount: 0,
    portfolioLinks: ["https://img.example.com/photo.jpg"],
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
    minKnownPrice: 900,
    maxKnownPrice: 1200,
    hasTransparentPricing: true,
    budgetFit: "good",
  },
  offers: [],
  serviceSpecific: {
    musicalStyles: ["house"],
    djSetFormats: [],
    mcServices: null,
    soundEquipment: [],
    lightingEquipment: [],
    specialMomentsSupport: [],
  },
  ...overrides,
})

describe("build profile payload", () => {
  it("builds payload with computed signals", () => {
    const profile = makeTestProfile()
    const payload = buildProfilePayload(profile)

    expect(payload.profile_title).toBe("DJ Test (Linkaband)")
    expect(payload.service_profile.serviceType).toBe("wedding-dj")
    expect(payload.signals.has_price).toBe(true)
    expect(payload.signals.price_min).toBe(900)
    expect(payload.signals.price_max).toBe(1200)
    expect(payload.signals.budget_fit).toBe("good")
  })

  it("handles profile with no pricing", () => {
    const profile = makeTestProfile({
      budgetSummary: {
        minKnownPrice: null,
        maxKnownPrice: null,
        hasTransparentPricing: false,
        budgetFit: "unknown",
      },
    })
    const payload = buildProfilePayload(profile)

    expect(payload.signals.has_price).toBe(false)
    expect(payload.signals.price_min).toBe(null)
    expect(payload.signals.budget_fit).toBe("unknown")
  })
})
