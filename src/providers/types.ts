import type { VerboseLog } from "../rendering/types.js"

export type { VerboseLog }

export interface ProviderFetchOptions {
  outputFile: string
  dryRun: boolean
  profileConcurrency: boolean
  fetchLimit?: number
  onFetchProgress?: (current: number, total: number, status?: string) => void
  verbose?: VerboseLog
  signal?: AbortSignal
}

export interface ProviderResult {
  success: boolean
  profileCount: number
}

export interface CliContext {
  linkabandLat: number
  linkabandLng: number
  linkabandDateFrom: string
  linkabandDateTo: string
  livetonightCategories: string[]
}

export interface Provider {
  readonly name: string
  readonly displayName: string
  readonly outputFile: string
  isAvailable(): boolean
  fetch(opts: ProviderFetchOptions, context: CliContext): Promise<ProviderResult>
}
