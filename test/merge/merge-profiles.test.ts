import { mkdtemp, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { describe, expect, it } from "vitest"

import { mergeProfiles } from "../../src/merge/merge-profiles.js"

describe("merge profiles", () => {
  it("deduplicates profiles by composite key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "presta-finder-"))
    const fileA = join(dir, "a.json")
    const fileB = join(dir, "b.json")

    const payload = {
      meta: {
        website: "site",
        kind: "profiles",
        count: 1,
        generatedAt: new Date().toISOString(),
        schemaVersion: "2.0",
      },
      results: [
        {
          kind: "profile",
          normalized: {
            website: "site",
            kind: "profile",
            id: 1,
            name: "A",
            url: null,
            slug: "a",
            description: null,
            location: { text: null, street_address: null, city: null, postcode: null, region: null, country: null, latitude: null, longitude: null },
            ratings: { value: null, count: null, best: null, worst: null, average: null },
            pricing: { min: null, max: null, raw: null, currency: null },
            categories: null,
            tags: null,
            media: { image_url: null, cover_urls: null, gallery_urls: null, video_urls: null },
            source: { url: null, slug: null, position: null, index: null, origin: null },
            flags: null,
            metrics: null,
            attributes: null,
          },
          raw: null,
        },
      ],
      raw: null,
    }

    await writeFile(fileA, JSON.stringify(payload), "utf-8")
    await writeFile(fileB, JSON.stringify(payload), "utf-8")
    const merged = await mergeProfiles([fileA, fileB])
    expect(merged).toHaveLength(1)
  })
})
