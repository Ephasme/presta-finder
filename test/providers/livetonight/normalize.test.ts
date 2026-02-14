import { describe, expect, it } from "vitest"

import { parseUser, buildProfile } from "../../../src/providers/livetonight/normalize.js"

describe("livetonight normalize", () => {
  it("normalizes user record", () => {
    const user = parseUser({
      id: 12,
      band_name: "LT DJ",
      slug: "lt-dj",
      address: "Paris, France",
      rating: 4.6,
      musician_reviews_count: 24,
      categories: ["DJ"],
    })
    const normalized = buildProfile(user)
    expect(normalized.website).toBe("livetonight")
    expect(normalized.name).toBe("LT DJ")
    expect(normalized.location.country).toBe("France")
  })
})
