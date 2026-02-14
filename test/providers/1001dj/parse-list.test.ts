import { describe, expect, it } from "vitest"

import { parseProfileList } from "../../../src/providers/1001dj/parse-list.js"

describe("1001dj parse list", () => {
  it("parses JSON-LD ItemList entries", () => {
    const html = `
      <html><head>
        <script type="application/ld+json">
          {
            "@type": "ItemList",
            "itemListElement": [
              {
                "position": 1,
                "item": {
                  "url": "https://www.1001dj.com/profil-dj-1234-demo.htm",
                  "name": "Demo DJ",
                  "priceRange": "€€",
                  "offers": {
                    "@type": "AggregateOffer",
                    "lowPrice": 500,
                    "highPrice": 1200,
                    "priceCurrency": "EUR"
                  }
                }
              }
            ]
          }
        </script>
      </head><body></body></html>
    `
    const parsed = parseProfileList([html])
    expect(parsed.meta.count).toBe(1)
    const profile = parsed.results[0].normalized
    expect(profile.name).toBe("Demo DJ")
    expect(profile.pricing.min).toBe(500)
    expect(profile.pricing.max).toBe(1200)
    expect(profile.pricing.currency).toBe("EUR")
  })

  it("parses localized rating values from JSON-LD", () => {
    const html = `
      <html><head>
        <script type="application/ld+json">
          {
            "@type": "ItemList",
            "itemListElement": [
              {
                "position": 1,
                "item": {
                  "url": "https://www.1001dj.com/profil-dj-4321-demo.htm",
                  "name": "Demo DJ",
                  "aggregateRating": {
                    "ratingValue": "4,9",
                    "ratingCount": 37
                  }
                }
              }
            ]
          }
        </script>
      </head><body></body></html>
    `
    const parsed = parseProfileList([html])
    const profile = parsed.results[0].normalized
    expect(profile.ratings.value).toBe(4.9)
    expect(profile.ratings.count).toBe(37)
  })
})
