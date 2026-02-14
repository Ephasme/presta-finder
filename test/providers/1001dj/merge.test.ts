import { describe, expect, it } from "vitest"

import { merge } from "../../../src/providers/1001dj/merge.js"
import type { ItemListEntry } from "../../../src/providers/1001dj/normalize.js"
import type { ProfilePageDetails } from "../../../src/providers/1001dj/parse-profile.js"
import type { ProfileParseOutcome } from "../../../src/providers/types.js"

const makeListingEntry = (overrides: Partial<ItemListEntry> = {}): ItemListEntry => ({
  position: 1,
  profile_id: 123,
  name: "DJ Test",
  url: "https://www.1001dj.com/profil-dj-123-test.htm",
  price_range: null,
  offer_low_price: 900,
  offer_high_price: 1200,
  offer_currency: "EUR",
  image_url: "https://img.example.com/test.jpg",
  latitude: 48.8566,
  longitude: 2.3522,
  street_address: null,
  address_locality: "Paris",
  postal_code: "75001",
  address_region: "Île-de-France",
  address_country: "France",
  rating_count: 10,
  rating_value: 4.5,
  worst_rating: 1,
  best_rating: 5,
  source: "jsonld",
  raw_item: {},
  ...overrides,
})

const makeProfilePageDetails = (
  overrides: Partial<ProfilePageDetails> = {},
): ProfilePageDetails => ({
  description: "Professional DJ",
  ratingValue: 4.5,
  ratingCount: 10,
  pricingMin: 900,
  pricingMax: 1200,
  pricingCurrency: "EUR",
  imageUrl: "https://img.example.com/profile.jpg",
  ...overrides,
})

describe("merge (1001dj)", () => {
  it("merges listing with profile page by URL", () => {
    const listings = [makeListingEntry()]
    const profileOutcomes: ProfileParseOutcome<ProfilePageDetails>[] = [
      {
        success: true,
        target: "https://www.1001dj.com/profil-dj-123-test.htm",
        data: makeProfilePageDetails(),
      },
    ]

    const { merged, errors } = merge(listings, profileOutcomes)

    expect(merged).toHaveLength(1)
    expect(merged[0]?.listing.name).toBe("DJ Test")
    expect(merged[0]?.profilePage).not.toBeNull()
    expect(merged[0]?.profilePage?.description).toBe("Professional DJ")
    expect(errors).toHaveLength(0)
  })

  it("falls back to profile_id when URL does not match", () => {
    const listings = [makeListingEntry({ url: "https://www.1001dj.com/profil-dj-123-old-url.htm" })]
    const profileOutcomes: ProfileParseOutcome<ProfilePageDetails>[] = [
      {
        success: true,
        target: "https://www.1001dj.com/profil-dj-123-new-url.htm",
        data: makeProfilePageDetails(),
      },
    ]

    const { merged, errors } = merge(listings, profileOutcomes)

    expect(merged).toHaveLength(1)
    expect(merged[0]?.profilePage).not.toBeNull()
    expect(errors).toHaveLength(0)
  })

  it("falls back to slug when URL and profile_id do not match", () => {
    const listings = [
      makeListingEntry({ profile_id: 999, url: "https://www.1001dj.com/profil-dj-999-test.htm" }),
    ]
    const profileOutcomes: ProfileParseOutcome<ProfilePageDetails>[] = [
      {
        success: true,
        target: "https://www.1001dj.com/profil-dj-123-test.htm",
        data: makeProfilePageDetails(),
      },
    ]

    const { merged, errors } = merge(listings, profileOutcomes)

    expect(merged).toHaveLength(1)
    expect(merged[0]?.profilePage).not.toBeNull() // Matched by slug "test"
    expect(errors).toHaveLength(0)
  })

  it("includes listing-only when profile fetch failed", () => {
    const listings = [makeListingEntry()]
    const profileOutcomes: ProfileParseOutcome<ProfilePageDetails>[] = [
      {
        success: false,
        target: "https://www.1001dj.com/profil-dj-123-test.htm",
        error: {
          code: "PROFILE_FETCH_FAILED",
          provider: "1001dj",
          step: "profile-fetch",
          target: "https://www.1001dj.com/profil-dj-123-test.htm",
          message: "Network error",
        },
      },
    ]

    const { merged, errors } = merge(listings, profileOutcomes)

    expect(merged).toHaveLength(1)
    expect(merged[0]?.listing.name).toBe("DJ Test")
    expect(merged[0]?.profilePage).toBeNull()
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe("PROFILE_FETCH_FAILED")
  })

  it("handles empty profile outcomes gracefully", () => {
    const listings = [
      makeListingEntry(),
      makeListingEntry({ profile_id: 456, url: "https://www.1001dj.com/profil-dj-456-other.htm" }),
    ]
    const profileOutcomes: ProfileParseOutcome<ProfilePageDetails>[] = []

    const { merged, errors } = merge(listings, profileOutcomes)

    expect(merged).toHaveLength(2)
    expect(merged[0]?.profilePage).toBeNull()
    expect(merged[1]?.profilePage).toBeNull()
    expect(errors).toHaveLength(0)
  })
})
