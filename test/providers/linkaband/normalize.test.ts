import { describe, expect, it } from "vitest"

import { parseArtist, buildProfile } from "../../../src/providers/linkaband/normalize.js"

describe("linkaband normalize", () => {
  it("maps artist payload to normalized profile", () => {
    const artist = parseArtist({
      id: 123,
      name: "Band A",
      slug: "band-a",
      styles: ["DJ"],
      players: ["Alice"],
      localisation: { city: "Paris", zipcode: "75001", country: "France" },
      global_rating: 4.8,
      nb_comments: 10,
    })
    const normalized = buildProfile(artist)
    expect(normalized.website).toBe("linkaband")
    expect(normalized.slug).toBe("band-a")
    expect(normalized.location.city).toBe("Paris")
  })
})
