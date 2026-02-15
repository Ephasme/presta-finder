import { describe, expect, it, vi } from "vitest"

import type { ArtifactReadArgs, ArtifactService, ArtifactSpec } from "../../src/providers/artifact-service.js"
import { CacheService } from "../../src/providers/cache-service.js"

class InMemoryArtifactService implements ArtifactService {
  private readonly storage = new Map<string, string>()

  private key(args: ArtifactReadArgs): string {
    return JSON.stringify([
      args.artifactType,
      args.request.method,
      args.request.url,
      args.request.body ?? null,
    ])
  }

  seed(args: ArtifactReadArgs, payload: string): void {
    this.storage.set(this.key(args), payload)
  }

  getStored(args: ArtifactReadArgs): string | undefined {
    return this.storage.get(this.key(args))
  }

  read(args: ArtifactReadArgs): Promise<string | null> {
    return Promise.resolve(this.storage.get(this.key(args)) ?? null)
  }

  write(artifacts: ArtifactSpec[]): Promise<string[]> {
    for (const artifact of artifacts) {
      this.storage.set(
        JSON.stringify([
          artifact.artifactType,
          artifact.request.method,
          artifact.request.url,
          artifact.request.body ?? null,
        ]),
        artifact.payload,
      )
    }
    return Promise.resolve(artifacts.map((_artifact, idx) => `artifact-${idx}`))
  }
}

describe("CacheService", () => {
  it("getJson refetches when cached JSON is invalid and replaces cache", async () => {
    const artifactService = new InMemoryArtifactService()
    const cacheService = new CacheService(artifactService)
    const args = {
      artifactType: "listing_response",
      request: { method: "GET", url: "https://example.com/list?page=19" },
    } as const

    artifactService.seed(args, '{"broken":')
    const fetchContent = vi.fn(() => Promise.resolve('{"ok":true}'))

    const parsed = await cacheService.getJSON({ ...args, fetchContent })
    expect(parsed).toEqual({ ok: true })
    expect(fetchContent).toHaveBeenCalledTimes(1)

    // Subsequent reads should use in-memory fixed payload, no extra fetch.
    const parsedAgain = await cacheService.getJSON({ ...args, fetchContent })
    expect(parsedAgain).toEqual({ ok: true })
    expect(fetchContent).toHaveBeenCalledTimes(1)

    await cacheService.flushPendingArtifacts()
    expect(artifactService.getStored(args)).toBe('{"ok":true}')
  })

  it("getHTML refetches when cached payload is not HTML", async () => {
    const artifactService = new InMemoryArtifactService()
    const cacheService = new CacheService(artifactService)
    const args = {
      artifactType: "profile_page",
      request: { method: "GET", url: "https://example.com/profile/123" },
    } as const

    artifactService.seed(args, '{"not":"html"}')
    const fetchContent = vi.fn(() => Promise.resolve("<!doctype html><html><body>ok</body></html>"))

    const html = await cacheService.getHTML({ ...args, fetchContent })
    expect(html).toContain("<html>")
    expect(fetchContent).toHaveBeenCalledTimes(1)
  })

  it("getHTML throws when fetched payload is still invalid HTML", async () => {
    const artifactService = new InMemoryArtifactService()
    const cacheService = new CacheService(artifactService)
    const args = {
      artifactType: "profile_page",
      request: { method: "GET", url: "https://example.com/profile/456" },
    } as const

    await expect(
      cacheService.getHTML({
        ...args,
        fetchContent: () => Promise.resolve('{"still":"json"}'),
      }),
    ).rejects.toThrow("Invalid HTML artifact payload for https://example.com/profile/456")
  })
})
