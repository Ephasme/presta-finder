export interface ArtifactRequest {
  method: string
  url: string
  body?: unknown
}

export interface ArtifactSpec {
  artifactType: string
  request: ArtifactRequest
  payload: string
}

export interface ArtifactReadArgs {
  artifactType: string
  request: ArtifactRequest
}

export interface ArtifactService {
  read(args: ArtifactReadArgs): Promise<string | null>
  write(artifacts: ArtifactSpec[]): Promise<string[]>
}
