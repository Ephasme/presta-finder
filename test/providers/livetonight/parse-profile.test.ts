import { describe, expect, it } from "vitest"

import { parseLiveTonightProfilePage } from "../../../src/providers/livetonight/parse-profile.js"

describe("livetonight parse profile page", () => {
  it("extracts generic details from profile html", () => {
    const html = `
      <html>
        <head>
          <meta property="og:image" content="https://example.com/lt.jpg" />
        </head>
        <body>
          <span class="lt-user-public__SubTitleContainer">
            <a href="#reviews" class="lt-user-public__SubTitleLink">5/5 (13 avis)</a>
          </span>
          <div class="musician-description">Live DJ set for weddings and private events</div>
          <div>Tarif 950 €</div>
        </body>
      </html>
    `
    const parsed = parseLiveTonightProfilePage(html)
    expect(parsed.description).toBe("Live DJ set for weddings and private events")
    expect(parsed.imageUrl).toBe("https://example.com/lt.jpg")
    expect(parsed.ratingValue).toBe(5)
    expect(parsed.ratingCount).toBe(13)
    expect(parsed.pricingMin).toBe(950)
  })
})
