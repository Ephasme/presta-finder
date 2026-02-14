import { describe, expect, it } from "vitest"

import { normalizeForWeddingDj } from "../../../src/providers/linkaband/normalize-profile-for-wedding-dj.js"
import type { ParsedLinkabandArtist } from "../../../src/providers/linkaband/types.js"
import type { ArtistProfile } from "../../../src/providers/linkaband/normalize.js"

const makeTestProfile = (overrides: Partial<ArtistProfile> = {}): ParsedLinkabandArtist => ({
  listing: {
    profile_id: 123,
    name: "DJ Nova",
    slug: "dj-nova",
    departement_name: "Paris",
    departement_zipcode: "75",
    verified: true,
    global_rating: 4.8,
    avg_rating: 4.8,
    nb_comments: 32,
    nb_membres: 1,
    response_time: "24h",
    profile_type: "dj",
    artiste_type: "DJ",
    super_artiste_type: "Musique",
    need_onboarding: false,
    outdated_availabilities: false,
    artiste_type_changed: false,
    index_flag: true,
    last_update: null,
    unavailabilities_count: null,
    formations_count: null,
    albums_count: null,
    abonnements_count: null,
    profile_picture: { url: null, original: null, url_bis: null },
    cover_pictures: [],
    top_profil: false,
    score: 100,
    default_image: { url: "https://img.example.com/main.jpg", original: null, url_bis: null },
    lowest_formation: {
      name: "DJ Set",
      description: "Solo DJ",
      nb_membres: 1,
      material: "sound system, wireless mic",
      lowest_prestation: {
        amount_one_brut: 900,
        amount_full_ht: null,
        amount_full_ttc: 1200,
        duration: "4h",
      },
    },
    category_names: ["house", "disco"],
    tag_names: ["open-format"],
    styles: ["house", "disco"],
    players: ["open-format"],
    localisation: { city: "Paris", zipcode: "75001", country: "France" },
    facturation: "travel fees may apply",
    response_delay_median: 3600,
    raw: {},
    ...overrides,
  },
  profilePage: {
    description: "Professional DJ",
    ratingValue: 4.8,
    ratingCount: 32,
    pricingMin: 900,
    pricingMax: 1200,
    pricingCurrency: "EUR",
    imageUrl: "https://img.example.com/profile.jpg",
  },
})

describe("normalizeForWeddingDj (linkaband)", () => {
  it("projects parsed profile to wedding-dj service profile", () => {
    const parsed = makeTestProfile()
    const mapped = normalizeForWeddingDj(parsed, 1000, 1300)

    expect(mapped.serviceType).toBe("wedding-dj")
    expect(mapped.provider).toBe("linkaband")
    expect(mapped.name).toBe("DJ Nova")
    // profileUrl is constructed from slug, not taken from listing.profile_url
    expect(mapped.profileUrl).toBe("https://linkaband.com/dj-nova")
    expect(mapped.serviceSpecific.musicalStyles).toEqual(["house", "disco"])
    expect(mapped.serviceSpecific.djSetFormats).toEqual(["open-format"])
    expect(mapped.professionalism.isVerified).toBe(true)
    expect(mapped.professionalism.responseTime).toBe("24h")
    expect(mapped.budgetSummary.budgetFit).toBe("good")
    expect(mapped.offers).toHaveLength(1)
    expect(mapped.offers[0]?.basePrice.amount).toBe(900)
    expect(mapped.offers[0]?.details.includedEquipment).toEqual(["sound system", "wireless mic"])
  })

  it("handles profile with no pricing", () => {
    const parsed = makeTestProfile({
      lowest_formation: null,
    })
    // Also remove profilePage pricing
    parsed.profilePage = null
    const mapped = normalizeForWeddingDj(parsed, 1000, 1300)

    expect(mapped.budgetSummary.hasTransparentPricing).toBe(false)
    expect(mapped.budgetSummary.budgetFit).toBe("unknown")
    expect(mapped.offers).toHaveLength(0)
  })
})
