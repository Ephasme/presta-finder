import { describe, expect, it, vi } from "vitest"

import type {
  ArtifactReadArgs,
  ArtifactService,
  ArtifactSpec,
} from "../../../src/providers/artifact-service.js"
import { CacheService } from "../../../src/providers/cache-service.js"
import { collectRecommendationIds } from "../../../src/providers/linkaband/fetch.js"

vi.mock("../../../src/utils/sleep.js", () => ({
  sleep: async () => {},
}))

class StubArtifactService implements ArtifactService {
  readonly reads: ArtifactReadArgs[] = []

  constructor(
    private readonly getPayload: (args: ArtifactReadArgs) => string | null,
  ) {}

  read(args: ArtifactReadArgs): Promise<string | null> {
    this.reads.push(args)
    return Promise.resolve(this.getPayload(args))
  }

  write(_artifacts: ArtifactSpec[]): Promise<string[]> {
    return Promise.resolve([])
  }
}

const pageFromUrl = (url: string): number => {
  const value = new URL(url).searchParams.get("page")
  return value ? Number.parseInt(value, 10) : 0
}

describe("collectRecommendationIds (linkaband)", () => {
  it("uses rating endpoint and website-aligned default query params", async () => {
    const artifactService = new StubArtifactService(({ request }) => {
      const page = pageFromUrl(request.url)
      if (page === 0) {
        return JSON.stringify({
          artist_ids: [101, 102],
          total_recommendations_count: 2,
        })
      }
      return JSON.stringify({ artist_ids: [] })
    })
    const cacheService = new CacheService(artifactService)

    const ids = await collectRecommendationIds(
      cacheService,
      {
        longitude: 2.351_376_5,
        latitude: 48.857_547_5,
        dateFrom: "23-02-2026",
        dateTo: "23-02-2026",
        landingType: "mariage",
        artistTypes: ["dj"],
      },
      {},
    )

    expect(ids).toEqual([101, 102])
    expect(artifactService.reads).toHaveLength(2)

    const firstRead = artifactService.reads[0]
    expect(firstRead).toBeDefined()
    const firstUrl = firstRead.request.url
    const parsed = new URL(firstUrl)
    expect(parsed.origin + parsed.pathname).toBe(
      "https://recommendations.linkaband.com/content_based/sim/search",
    )
    expect(parsed.searchParams.get("landing_type")).toBe("mariage")
    expect(parsed.searchParams.get("artist_types")).toBe("[\"dj\"]")
    expect(parsed.searchParams.get("super_artiste_type")).toBe("1")
    expect(parsed.searchParams.get("limit")).toBe("18")
    expect(parsed.searchParams.get("config")).toBe("v0.4.0")
  })

  it("continues beyond 200 pages when total_recommendations_count requires it", async () => {
    const expectedFullPages = 223
    const pageSize = 18
    const artifactService = new StubArtifactService(({ request }) => {
      const page = pageFromUrl(request.url)
      if (page < expectedFullPages) {
        return JSON.stringify({
          artist_ids: Array.from({ length: pageSize }, (_, idx) => page * pageSize + idx + 1),
          total_recommendations_count: 18, // intentionally misleading
        })
      }
      return JSON.stringify({
        artist_ids: [],
        total_recommendations_count: 18,
      })
    })
    const cacheService = new CacheService(artifactService)

    const ids = await collectRecommendationIds(
      cacheService,
      {
        longitude: 2.351_376_5,
        latitude: 48.857_547_5,
        dateFrom: "23-02-2026",
        dateTo: "23-02-2026",
        landingType: "mariage",
        artistTypes: ["dj"],
      },
      {},
    )

    expect(ids).toHaveLength(expectedFullPages * pageSize)
    expect(ids[0]).toBe(1)
    expect(ids.at(-1)).toBe(expectedFullPages * pageSize)

    expect(artifactService.reads).toHaveLength(expectedFullPages + 1)
    const lastRead = artifactService.reads.at(-1)
    expect(lastRead).toBeDefined()
    const lastPageRequested = pageFromUrl(lastRead.request.url)
    expect(lastPageRequested).toBe(expectedFullPages)
  })

  it("continues past partial pages and stops only when artist_ids is empty", async () => {
    const artifactService = new StubArtifactService(({ request }) => {
      const page = pageFromUrl(request.url)
      if (page === 0) {
        return JSON.stringify({ artist_ids: Array.from({ length: 18 }, (_, idx) => idx + 1) })
      }
      if (page === 1) {
        return JSON.stringify({ artist_ids: [19, 20, 21] })
      }
      if (page === 2) {
        return JSON.stringify({ artist_ids: [22] })
      }
      return JSON.stringify({ artist_ids: [] })
    })
    const cacheService = new CacheService(artifactService)

    const ids = await collectRecommendationIds(
      cacheService,
      {
        longitude: 2.351_376_5,
        latitude: 48.857_547_5,
        dateFrom: "23-02-2026",
        dateTo: "23-02-2026",
        landingType: "mariage",
        artistTypes: ["dj"],
      },
      {},
    )

    expect(ids).toEqual(Array.from({ length: 22 }, (_, idx) => idx + 1))
    expect(artifactService.reads).toHaveLength(4)
  })
})
