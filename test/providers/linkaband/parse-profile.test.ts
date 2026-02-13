import { describe, expect, it } from "vitest"

import { parseLinkabandProfilePage } from "../../../src/providers/linkaband/parse-profile.js"

describe("linkaband parse profile page", () => {
  it("extracts generic details from profile html", () => {
    const html = `
      <html>
        <head>
          <meta property="og:description" content="DJ for premium weddings" />
          <meta property="og:image" content="https://example.com/img.jpg" />
        </head>
        <body>
          <div class="artist-card-extended__name">Thibault & Arnaud - DJ/Percussion 5.0 (10)</div>
          <div class="artist-description">Wedding DJ specialist</div>
          <div>42 avis</div>
          <div>Starting at 1200 €</div>
        </body>
      </html>
    `
    const parsed = parseLinkabandProfilePage(html)
    expect(parsed.description).toBe("Wedding DJ specialist")
    expect(parsed.imageUrl).toBe("https://example.com/img.jpg")
    expect(parsed.ratingValue).toBe(5)
    expect(parsed.ratingCount).toBe(10)
    expect(parsed.pricingMin).toBe(1200)
  })
})
