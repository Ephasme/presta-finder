import type { ProviderCapability, SearchContext } from "../service-types/types.js"
import type { AnyServiceProfile } from "../service-types/merged.js"
import type { VerboseLog } from "../rendering/types.js"
import type { CacheService } from "./cache-service.js"

export type { VerboseLog }

// ── Pipeline stage contracts ────────────────────────────────────────

export type ProfileFetchOutcome =
  | { success: true; target: string; html: string }
  | { success: false; target: string; error: PipelineError }

export type ProfileParseOutcome<TProfileDetails> =
  | { success: true; target: string; data: TProfileDetails }
  | { success: false; target: string; error: PipelineError }

// ── Error model ─────────────────────────────────────────────────────

export type PipelineErrorCode =
  | "LISTING_FETCH_FAILED"
  | "LISTING_PARSE_FAILED"
  | "PROFILE_FETCH_FAILED"
  | "PROFILE_PARSE_FAILED"
  | "MERGE_FAILED"
  | "NORMALIZE_FAILED"
  | "CANCELLED"

export interface PipelineError {
  code: PipelineErrorCode
  provider: string
  step:
    | "listing-fetch"
    | "listing-parse"
    | "profile-fetch"
    | "profile-parse"
    | "merge"
    | "normalize"
  /** Identifier of the failing target (URL, vendor ID, slug). Never contains secrets. */
  target: string | null
  /** Human-readable message. Never contains auth tokens or API keys. */
  message: string
}

const SENSITIVE_PARAM_NAMES = new Set([
  "apikey",
  "api_key",
  "token",
  "auth",
  "key",
  "secret",
  "password",
  "access_token",
  "bearer",
])

const MAX_MESSAGE_LENGTH = 200

/**
 * Strip sensitive query parameters and auth tokens from a URL or message
 * before including it in a PipelineError.
 */
export const sanitizeForError = (input: string): string => {
  // Strip Bearer / Basic auth prefixes from inline tokens
  let cleaned = input.replaceAll(/\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi, "$1 [REDACTED]")

  // Strip sensitive query parameters from URLs
  try {
    const url = new URL(cleaned)
    let hasSensitive = false
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_PARAM_NAMES.has(key.toLowerCase())) {
        url.searchParams.set(key, "[REDACTED]")
        hasSensitive = true
      }
    }
    if (hasSensitive) {
      cleaned = url.toString()
    }
  } catch {
    // Not a valid URL — apply regex fallback
    cleaned = cleaned.replaceAll(
      /([?&])(apikey|api_key|token|auth|key|secret|password|access_token|bearer)=[^&\s]*/gi,
      "$1$2=[REDACTED]",
    )
  }

  // Truncate to max length
  if (cleaned.length > MAX_MESSAGE_LENGTH) {
    return `${cleaned.slice(0, MAX_MESSAGE_LENGTH - 3)}...`
  }
  return cleaned
}

// ── Provider interface (run only) ───────────────────────────────────

export interface ProviderRunOptions {
  outputDir: string
  cacheService: CacheService
  dryRun: boolean
  /** Max parallel profile-page fetches. Defaults to 4, or 1 when --no-profile-concurrency. */
  profileConcurrency: number
  fetchLimit?: number
  /** Budget parameters — needed by normalize step inside run(). */
  budgetTarget: number
  budgetMax: number
  onProgress?: (current: number, total: number, status?: string) => void
  verbose?: VerboseLog
  signal?: AbortSignal
}

export interface ProviderRunResult {
  profiles: AnyServiceProfile[]
  profileCount: number
  errors: PipelineError[]
}

export interface Provider {
  readonly name: string
  readonly displayName: string
  readonly capabilities: readonly ProviderCapability[]
  isAvailable(): boolean
  run(opts: ProviderRunOptions, context: SearchContext): Promise<ProviderRunResult>
}
