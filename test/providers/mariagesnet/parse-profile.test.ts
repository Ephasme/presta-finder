import { describe, expect, it } from "vitest"

import { parseMariagesnetProfilePage } from "../../../src/providers/mariagesnet/parse-profile.js"

describe("mariagesnet parse profile page", () => {
  it("extracts generic details from profile html", () => {
    const html = `
      <html>
        <head>
          <meta name="description" content="Animation DJ mariage haut de gamme" />
        </head>
        <body>
          <span class="storefrontHeadingReviews__stars" data-testid="storefrontHeadingReviewsStars">
            Note globale 5.0 sur 5 5.0 Fabuleux
          </span>
          <div class="vendor-description">DJ, son et lumiere pour mariage</div>
          <div>107+ avis</div>
          <div>A partir de 1 500 €</div>
        </body>
      </html>
    `
    const parsed = parseMariagesnetProfilePage(html)
    expect(parsed.description).toBe("DJ, son et lumiere pour mariage")
    expect(parsed.ratingValue).toBe(5)
    expect(parsed.ratingCount).toBe(107)
    expect(parsed.pricingMin).toBe(1500)
  })
})
