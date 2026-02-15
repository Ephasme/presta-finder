import type { ArtifactRequest, ArtifactService, ArtifactSpec } from "./artifact-service.js"
import { toRecordOrEmpty } from "../utils/type-guards.js"
import { z } from "zod"

export interface CacheServiceGetOrFetchArgs {
  artifactType: string
  request: ArtifactRequest
  fetchContent: () => Promise<string>
}

export type CacheServiceGetRawArgs = CacheServiceGetOrFetchArgs
export interface CacheServiceGetJsonArgs<TParsed = unknown>
  extends CacheServiceGetOrFetchArgs {
  schema?: z.ZodType<TParsed>
}
export type CacheServiceGetHtmlArgs = CacheServiceGetOrFetchArgs

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

const looksLikeHtml = (payload: string): boolean => {
  const trimmed = payload.trimStart()
  if (!trimmed) {
    return false
  }
  const head = trimmed.slice(0, 512).toLowerCase()
  if (head.startsWith("<!doctype html") || head.startsWith("<html")) {
    return true
  }
  return /<[a-z][a-z0-9-]*(?:\s|>)/i.test(head)
}

const parseJsonPayload = <TParsed>(
  payload: string,
  requestUrl: string,
  schema?: z.ZodType<TParsed>,
): unknown => {
  let raw: unknown
  try {
    raw = JSON.parse(payload)
  } catch {
    throw new Error(`Invalid JSON artifact payload for ${requestUrl}`)
  }
  if (schema) {
    try {
      return schema.parse(raw)
    } catch {
      throw new Error(`Invalid JSON artifact payload for ${requestUrl}`)
    }
  }
  return raw
}

export class CacheService {
  private pendingArtifacts: ArtifactSpec[] = []
  private readonly pendingArtifactIndexes = new Map<string, number>()
  private readonly inMemoryArtifactPayloads = new Map<string, string>()

  constructor(private readonly artifactService: ArtifactService) {}

  private buildArtifactKey(artifactType: string, request: ArtifactRequest): string {
    return `${artifactType}:${stableSerialize(request)}`
  }

  private rememberArtifact(spec: ArtifactSpec): void {
    const key = this.buildArtifactKey(spec.artifactType, spec.request)
    this.inMemoryArtifactPayloads.set(key, spec.payload)

    const existingIndex = this.pendingArtifactIndexes.get(key)
    if (existingIndex === undefined) {
      this.pendingArtifacts.push(spec)
      this.pendingArtifactIndexes.set(key, this.pendingArtifacts.length - 1)
      return
    }
    this.pendingArtifacts[existingIndex] = spec
  }

  private async readCachedPayload(
    artifactType: string,
    request: ArtifactRequest,
  ): Promise<string | null> {
    const key = this.buildArtifactKey(artifactType, request)
    const inMemoryPayload = this.inMemoryArtifactPayloads.get(key)
    if (inMemoryPayload !== undefined) {
      return inMemoryPayload
    }
    return this.artifactService.read({
      artifactType,
      request,
    })
  }

  private async fetchAndRemember(args: CacheServiceGetRawArgs): Promise<string> {
    const fetchedPayload = await args.fetchContent()
    this.rememberArtifact({
      artifactType: args.artifactType,
      request: args.request,
      payload: fetchedPayload,
    })
    return fetchedPayload
  }

  async getRaw(args: CacheServiceGetRawArgs): Promise<string> {
    const cachedPayload = await this.readCachedPayload(args.artifactType, args.request)
    if (cachedPayload !== null) {
      return cachedPayload
    }
    return this.fetchAndRemember(args)
  }

  async getJSON(args: CacheServiceGetJsonArgs): Promise<unknown>
  async getJSON<TParsed>(
    args: CacheServiceGetJsonArgs<TParsed> & { schema: z.ZodType<TParsed> },
  ): Promise<TParsed>
  async getJSON<TParsed>(args: CacheServiceGetJsonArgs<TParsed>): Promise<unknown> {
    const cachedPayload = await this.readCachedPayload(args.artifactType, args.request)
    if (cachedPayload !== null) {
      try {
        return parseJsonPayload(cachedPayload, args.request.url, args.schema)
      } catch {
        // Invalid cache payload: refetch and replace.
      }
    }

    const fetchedPayload = await args.fetchContent()
    try {
      const parsed = parseJsonPayload(fetchedPayload, args.request.url, args.schema)
      this.rememberArtifact({
        artifactType: args.artifactType,
        request: args.request,
        payload: fetchedPayload,
      })
      return parsed
    } catch {
      throw new Error(`Invalid JSON artifact payload for ${args.request.url}`)
    }
  }

  async getHTML(args: CacheServiceGetHtmlArgs): Promise<string> {
    const cachedPayload = await this.readCachedPayload(args.artifactType, args.request)
    if (cachedPayload !== null && looksLikeHtml(cachedPayload)) {
      return cachedPayload
    }

    const fetchedPayload = await args.fetchContent()
    if (!looksLikeHtml(fetchedPayload)) {
      throw new Error(`Invalid HTML artifact payload for ${args.request.url}`)
    }
    this.rememberArtifact({
      artifactType: args.artifactType,
      request: args.request,
      payload: fetchedPayload,
    })
    return fetchedPayload
  }

  async getOrFetchArtifact(args: CacheServiceGetOrFetchArgs): Promise<string> {
    return this.getRaw(args)
  }

  async getHtml(args: CacheServiceGetHtmlArgs): Promise<string> {
    return this.getHTML(args)
  }

  async flushPendingArtifacts(): Promise<string[]> {
    const artifactsToPersist = [...this.pendingArtifacts]
    this.pendingArtifacts = []
    this.pendingArtifactIndexes.clear()
    return this.artifactService.write(artifactsToPersist)
  }
}
