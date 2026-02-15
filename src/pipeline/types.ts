import type { AnyServiceProfile } from "../service-types/merged.js"

export interface ProfileTask {
  /** Provider name (e.g. "1001dj", "linkaband") */
  provider: string
  /** Provider display name (e.g. "Linkaband") */
  displayName: string
  /**
   * Dedup key: JSON.stringify([provider, target]).
   * `target` is the listing-level unique identifier (URL, slug).
   * Never uses providerId (may be null at listing time).
   */
  dedupKey: string
  /** Human-readable target for logging (URL or slug) */
  target: string
  /**
   * Fetch profile page + parse + normalize.
   * Handles fetch/parse failures gracefully by setting profilePage=null
   * and returning a listing-only ServiceProfile.
   * Only throws on truly unexpected errors (normalize crash).
   */
  execute(signal?: AbortSignal): Promise<AnyServiceProfile>
}
