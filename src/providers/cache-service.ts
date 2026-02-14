import type { ArtifactRequest, ArtifactService, ArtifactSpec } from "./artifact-service.js"

export interface CacheServiceGetOrFetchArgs {
  artifactType: string
  request: ArtifactRequest
  fetchContent: () => Promise<string>
}

export class CacheService {
  private pendingArtifacts: ArtifactSpec[] = []

  constructor(private readonly artifactService: ArtifactService) {}

  async getOrFetchArtifact(args: CacheServiceGetOrFetchArgs): Promise<string> {
    const cachedPayload = await this.artifactService.read({
      artifactType: args.artifactType,
      request: args.request,
    })
    if (cachedPayload !== null) {
      return cachedPayload
    }
    const fetchedPayload = await args.fetchContent()
    this.pendingArtifacts.push({
      artifactType: args.artifactType,
      request: args.request,
      payload: fetchedPayload,
    })
    return fetchedPayload
  }

  async flushPendingArtifacts(): Promise<string[]> {
    const artifactsToPersist = [...this.pendingArtifacts]
    this.pendingArtifacts = []
    return this.artifactService.write(artifactsToPersist)
  }
}
