import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import type {
  ArtifactReadArgs,
  ArtifactRequest,
  ArtifactService,
  ArtifactSpec,
} from "./artifact-service.js"
import { toRecordOrEmpty } from "../utils/type-guards.js"

export interface FileArtifactServiceConfig {
  rawDir?: string
}

type RawArtifactBucket = "listings" | "profiles"

const DEFAULT_SHARED_RAW_DIR = join(homedir(), ".presta-finder", "raw")

const artifactBucketByType: Readonly<Partial<Record<string, RawArtifactBucket>>> = {
  listing_recommendation_response: "listings",
  listing_page: "listings",
  listing_response: "listings",
  listing_profile_batch_response: "profiles",
  profile_page: "profiles",
  profile_response: "profiles",
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

const resolveRawDir = (rawDir?: string): string => {
  if (!rawDir) {
    return DEFAULT_SHARED_RAW_DIR
  }
  if (rawDir === "~") {
    return homedir()
  }
  if (rawDir.startsWith("~/")) {
    return join(homedir(), rawDir.slice(2))
  }
  return rawDir
}

const resolveArtifactBucket = (artifactType: string): RawArtifactBucket => {
  const normalizedType = sanitizeArtifactType(artifactType)
  const explicitBucket = artifactBucketByType[normalizedType]
  if (explicitBucket) {
    return explicitBucket
  }
  return normalizedType.includes("profile") ? "profiles" : "listings"
}

export class FileArtifactService implements ArtifactService {
  private readonly rawDir: string

  constructor(config: FileArtifactServiceConfig = {}) {
    this.rawDir = resolveRawDir(config.rawDir)
  }

  private buildArtifactFileName(request: ArtifactRequest): string {
    const fingerprint = buildFingerprint(request)
    return `${fingerprint}.txt`
  }

  private resolveArtifactPath(artifactType: string, request: ArtifactRequest): string {
    const bucket = resolveArtifactBucket(artifactType)
    return join(this.rawDir, bucket, this.buildArtifactFileName(request))
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
    if (artifacts.length === 0) {
      return []
    }
    const files: string[] = []

    for (const artifact of artifacts) {
      const targetFile = this.resolveArtifactPath(artifact.artifactType, artifact.request)
      await mkdir(dirname(targetFile), { recursive: true })
      await writeFile(targetFile, artifact.payload, "utf-8")
      files.push(targetFile)
    }

    return files
  }
}
