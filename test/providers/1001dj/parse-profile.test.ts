import { describe, expect, it } from "vitest"

import { parseProfilePage } from "../../../src/providers/1001dj/parse-profile.js"

describe("1001dj parse profile page", () => {
  it("extracts offers pricing, description and rating count", () => {
    const html = `
      <html>
        <head>
          <meta property="og:image" content="https://cdn.example.com/pic.jpg" />
          <script type="application/ld+json">
            {
              "@type": "EntertainmentBusiness",
              "offers": {
                "@type": "AggregateOffer",
                "lowPrice": 600,
                "highPrice": 1400,
                "priceCurrency": "EUR"
              }
            }
          </script>
        </head>
        <body>
          <div class="description-truncate-lines"><p>DJ set premium for weddings</p></div>
          <div>25 evaluations</div>
          <div class="list-rating br-radius-1 p-3 fs-13">
            Coup de coeur 54%
            Ambiance de folie 15%
            Parfait 27%
            Super - de 1%
            Très bien 2%
            Bien - de 1%
            Je ne recommande pas 0%
          </div>
        </body>
      </html>
    `

    const parsed = parseProfilePage(html)
    expect(parsed.pricingMin).toBe(600)
    expect(parsed.pricingMax).toBe(1400)
    expect(parsed.pricingCurrency).toBe("EUR")
    expect(parsed.description).toBe("DJ set premium for weddings")
    expect(parsed.imageUrl).toBe("https://cdn.example.com/pic.jpg")
    expect(parsed.ratingValue).toBe(4.8)
    expect(parsed.ratingCount).toBe(25)
    expect(parsed.ratingPerformance).toEqual({
      coupDeCoeurPct: 54,
      parfaitPct: 27,
      ambianceDeFoliePct: 15,
      topTierPct: 96,
    })
  })
})
