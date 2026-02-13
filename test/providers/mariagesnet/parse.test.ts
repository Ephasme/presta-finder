import { describe, expect, it } from "vitest"

import { parseMariagesnet } from "../../../src/providers/mariagesnet/parse.js"

describe("mariagesnet parse", () => {
  it("extracts vendor from listingResults", () => {
    const payload = {
      listingResults:
        '<ul><li data-vendor-id="v1" data-vendor-info="{&quot;price&quot;:&quot;900&quot;,&quot;currency&quot;:&quot;EUR&quot;,&quot;sector&quot;:&quot;DJ&quot;}"><a data-test-id="storefrontTitle" href="https://example.com/vendor">Vendor Name</a><div class="vendorTile__location">Paris</div><p class="vendorTile__description">desc</p><span aria-label="Note globale 4.9 sur 5, 12 avis"></span></li></ul>',
      mapMarkers: [{ vendorId: "v1", lat: 48.85, lng: 2.35 }],
      listingVendorsGalleryJson: { v1: [{ srcJpeg320: "https://img.test/pic.jpg" }] },
      resultVendorsIds: ["v1"],
    }
    const parsed = parseMariagesnet(payload)
    expect(parsed.meta.count).toBe(1)
    expect(parsed.results[0]?.normalized.name).toBe("Vendor Name")
  })
})
