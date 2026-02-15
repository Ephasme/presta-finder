import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import { describe, expect, it } from "vitest"

import type { ArtifactRequest } from "../../src/providers/artifact-service.js"
import { FileArtifactService } from "../../src/providers/file-artifact-service.js"

const makeTempRawDir = async (): Promise<string> => mkdtemp(join(tmpdir(), "presta-finder-raw-"))

const cleanTempDir = async (rawDir: string): Promise<void> => {
  await rm(rawDir, { recursive: true, force: true })
}

const expectHasFingerprintName = (filePath: string): void => {
  expect(basename(filePath)).toMatch(/^[0-9a-f]{16}\.txt$/)
}

describe("FileArtifactService", () => {
  it("writes and reads profile_page artifacts from profiles bucket", async () => {
    const rawDir = await makeTempRawDir()

    try {
      const service = new FileArtifactService({ rawDir })
      const request: ArtifactRequest = { method: "GET", url: "https://example.com/profiles/42" }
      const payload = "<html>profile page</html>"

      const files = await service.write([{ artifactType: "profile_page", request, payload }])
      expect(files).toHaveLength(1)
      const writtenFile = files[0]
      expect(writtenFile.startsWith(join(rawDir, "profiles"))).toBe(true)
      expectHasFingerprintName(writtenFile)

      const cached = await service.read({ artifactType: "profile_page", request })
      expect(cached).toBe(payload)
    } finally {
      await cleanTempDir(rawDir)
    }
  })

  it("writes and reads listing_response artifacts from listings bucket", async () => {
    const rawDir = await makeTempRawDir()

    try {
      const service = new FileArtifactService({ rawDir })
      const request: ArtifactRequest = { method: "GET", url: "https://example.com/listings?page=1" }
      const payload = '{"results":[1,2,3]}'

      const files = await service.write([{ artifactType: "listing_response", request, payload }])
      expect(files).toHaveLength(1)
      const writtenFile = files[0]
      expect(writtenFile.startsWith(join(rawDir, "listings"))).toBe(true)
      expectHasFingerprintName(writtenFile)

      const cached = await service.read({ artifactType: "listing_response", request })
      expect(cached).toBe(payload)
    } finally {
      await cleanTempDir(rawDir)
    }
  })

  it("routes listing_profile_batch_response to profiles bucket", async () => {
    const rawDir = await makeTempRawDir()

    try {
      const service = new FileArtifactService({ rawDir })
      const request: ArtifactRequest = { method: "POST", url: "https://example.com/batch" }
      const payload = '{"kind":"batch"}'

      const files = await service.write([
        { artifactType: "listing_profile_batch_response", request, payload },
      ])
      expect(files).toHaveLength(1)
      const writtenFile = files[0]
      expect(writtenFile.startsWith(join(rawDir, "profiles"))).toBe(true)
      expectHasFingerprintName(writtenFile)

      const cached = await service.read({
        artifactType: "listing_profile_batch_response",
        request,
      })
      expect(cached).toBe(payload)
    } finally {
      await cleanTempDir(rawDir)
    }
  })

  it("uses profile heuristic fallback for unknown artifact types", async () => {
    const rawDir = await makeTempRawDir()

    try {
      const service = new FileArtifactService({ rawDir })
      const request: ArtifactRequest = { method: "GET", url: "https://example.com/unknown/entry" }
      const payload = "fallback payload"

      const files = await service.write([
        { artifactType: "custom_profile_snapshot", request, payload },
      ])
      expect(files).toHaveLength(1)
      const writtenFile = files[0]
      expect(writtenFile.startsWith(join(rawDir, "profiles"))).toBe(true)
      expectHasFingerprintName(writtenFile)

      const cached = await service.read({ artifactType: "custom_profile_snapshot", request })
      expect(cached).toBe(payload)
    } finally {
      await cleanTempDir(rawDir)
    }
  })
})
