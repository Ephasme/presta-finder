import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { z } from "zod"

import type {
  ArtifactReadArgs,
  ArtifactRequest,
  ArtifactService,
  ArtifactSpec,
} from "./artifact-service.js"
import { toRecordOrEmpty } from "../utils/type-guards.js"

const artifactRequestSchema = z.object({
  method: z.string(),
  url: z.string(),
  body: z.unknown().optional(),
})

const fileArtifactManifestEntrySchema = z.object({
  artifactType: z.string(),
  fingerprint: z.string(),
  fileName: z.string(),
  request: artifactRequestSchema,
})

const fileArtifactManifestSchema = z.object({
  providerId: z.string(),
  artifacts: z.array(fileArtifactManifestEntrySchema),
})

type FileArtifactManifestEntry = z.infer<typeof fileArtifactManifestEntrySchema>
type FileArtifactManifest = z.infer<typeof fileArtifactManifestSchema>

export interface FileArtifactServiceConfig {
  outputFile: string
  providerId: string
}

const stableSerialize = (value: unknown): string => {
  if (value === null) {
    return "null"
  }
  if (typeof value !== "object") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`
  }
  const entries = Object.entries(toRecordOrEmpty(value)).sort(([a], [b]) => a.localeCompare(b))
  const serializedEntries = entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`)
    .join(",")
  return `{${serializedEntries}}`
}

const buildFingerprint = (request: ArtifactRequest): string =>
  createHash("sha1").update(stableSerialize(request)).digest("hex").slice(0, 16)

const sanitizeArtifactType = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/g, "_")
    .replaceAll(/^_+|_+$/g, "") || "artifact"

const manifestEntryKey = (entry: FileArtifactManifestEntry): string =>
  `${entry.artifactType}:${entry.fingerprint}`

export class FileArtifactService implements ArtifactService {
  private readonly runOutputDir: string

  constructor(private readonly config: FileArtifactServiceConfig) {
    this.runOutputDir = dirname(config.outputFile)
  }

  private resolveProviderRawDir(): string {
    return join(this.runOutputDir, "raw", this.config.providerId)
  }

  private resolveProviderArtifactsDir(): string {
    return join(this.resolveProviderRawDir(), "artifacts")
  }

  private resolveManifestPath(): string {
    return join(this.resolveProviderRawDir(), "manifest.json")
  }

  private buildArtifactFileName(artifactType: string, request: ArtifactRequest): string {
    const sanitizedArtifactType = sanitizeArtifactType(artifactType)
    const fingerprint = buildFingerprint(request)
    return `${sanitizedArtifactType}_${fingerprint}.json`
  }

  private resolveArtifactPath(artifactType: string, request: ArtifactRequest): string {
    return join(
      this.resolveProviderArtifactsDir(),
      this.buildArtifactFileName(artifactType, request),
    )
  }

  private async readExistingManifest(): Promise<FileArtifactManifestEntry[]> {
    try {
      const manifestPayload = await readFile(this.resolveManifestPath(), "utf-8")
      let raw: unknown
      try {
        raw = JSON.parse(manifestPayload)
      } catch {
        return []
      }
      const parsed = fileArtifactManifestSchema.safeParse(raw)
      if (!parsed.success) {
        return []
      }
      return parsed.data.artifacts
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return []
      }
      throw error
    }
  }

  async read(args: ArtifactReadArgs): Promise<string | null> {
    const artifactPath = this.resolveArtifactPath(args.artifactType, args.request)
    try {
      return await readFile(artifactPath, "utf-8")
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null
      }
      throw error
    }
  }

  async write(artifacts: ArtifactSpec[]): Promise<string[]> {
    const providerArtifactsDir = this.resolveProviderArtifactsDir()
    await mkdir(providerArtifactsDir, { recursive: true })

    const files: string[] = []
    const newManifestEntries: FileArtifactManifestEntry[] = []
    const existingManifestEntries = await this.readExistingManifest()

    for (const artifact of artifacts) {
      const artifactType = sanitizeArtifactType(artifact.artifactType)
      const fileName = this.buildArtifactFileName(artifactType, artifact.request)
      const targetFile = join(providerArtifactsDir, fileName)
      const fingerprint = buildFingerprint(artifact.request)
      await writeFile(targetFile, artifact.payload, "utf-8")
      files.push(targetFile)
      newManifestEntries.push({
        artifactType,
        fingerprint,
        fileName,
        request: artifact.request,
      })
    }

    const mergedManifestEntriesByKey = new Map<string, FileArtifactManifestEntry>()
    for (const existingEntry of existingManifestEntries) {
      mergedManifestEntriesByKey.set(manifestEntryKey(existingEntry), existingEntry)
    }
    for (const newEntry of newManifestEntries) {
      mergedManifestEntriesByKey.set(manifestEntryKey(newEntry), newEntry)
    }

    const manifestPayload: FileArtifactManifest = {
      providerId: this.config.providerId,
      artifacts: [...mergedManifestEntriesByKey.values()],
    }
    const manifestPath = this.resolveManifestPath()
    await writeFile(manifestPath, `${JSON.stringify(manifestPayload, null, 2)}\n`, "utf-8")
    files.push(manifestPath)

    return files
  }
}
