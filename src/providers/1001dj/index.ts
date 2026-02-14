import pLimit from "p-limit"
import type { ProviderCapability, SearchContext } from "../../service-types/types.js"
import type { ServiceProfile } from "../../service-types/merged.js"
import { throwIfAborted } from "../../utils/cancel.js"
import { sleep } from "../../utils/sleep.js"
import type {
  PipelineError,
  ProfileFetchOutcome,
  ProfileParseOutcome,
  Provider,
  ProviderRunOptions,
  ProviderRunResult,
} from "../types.js"
import { sanitizeForError } from "../types.js"
import { DEFAULT_ENDPOINT, fetchListingPages, fetchProfilePage } from "./fetch.js"
import { parseListingPages } from "./parse-list.js"
import { parseProfilePage, type ProfilePageDetails } from "./parse-profile.js"
import { merge } from "./merge.js"
import { normalizeForWeddingDj } from "./normalize-profile-for-wedding-dj.js"

const CHUNK_SIZE = 50
const PROFILE_DELAY_MS = 30

export class Dj1001Provider implements Provider {
  readonly name = "1001dj" as const
  readonly displayName = "1001dj"

  readonly capabilities: readonly ProviderCapability[] = [
    {
      serviceTypeId: "wedding-dj",
      searchParams: { typeEvent: "mariage" },
    },
  ]

  isAvailable(): boolean {
    return true
  }

  async run(opts: ProviderRunOptions, _context: SearchContext): Promise<ProviderRunResult> {
    const errors: PipelineError[] = []
    if (opts.dryRun) {
      return { profiles: [], profileCount: 0, errors }
    }

    // ── 1. Listing fetch + parse (fatal on failure) ──────────────
    const listingHtmlPages = await fetchListingPages(
      opts.cacheService,
      { typeEvent: "mariage" },
      { fetchLimit: opts.fetchLimit, signal: opts.signal, verbose: opts.verbose },
    )
    const listings = parseListingPages(listingHtmlPages)

    // ── 2. Profile fetch (chunked, non-fatal per URL) ────────────
    const targets = listings.map((entry) => entry.url).slice(0, opts.fetchLimit)
    const allFetchOutcomes: ProfileFetchOutcome[] = []
    const limit = pLimit(opts.profileConcurrency)

    for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
      throwIfAborted(opts.signal)
      const chunk = targets.slice(i, i + CHUNK_SIZE)

      const chunkResults = await Promise.all(
        chunk.map((url) =>
          limit(async (): Promise<ProfileFetchOutcome> => {
            try {
              const outcome = await fetchProfilePage(opts.cacheService, url, {
                referer: DEFAULT_ENDPOINT,
                signal: opts.signal,
              })
              await sleep(PROFILE_DELAY_MS, opts.signal)
              return outcome
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              return {
                success: false,
                target: url,
                error: {
                  code: "PROFILE_FETCH_FAILED",
                  provider: "1001dj",
                  step: "profile-fetch",
                  target: sanitizeForError(url),
                  message: sanitizeForError(message),
                },
              }
            }
          }),
        ),
      )

      allFetchOutcomes.push(...chunkResults)
      opts.onProgress?.(Math.min(i + CHUNK_SIZE, targets.length), targets.length)
    }

    // Collect fetch errors
    for (const outcome of allFetchOutcomes) {
      if (!outcome.success) {
        errors.push(outcome.error)
      }
    }

    // ── 3. Parse profile pages (non-fatal per page) ──────────────
    const parseOutcomes: ProfileParseOutcome<ProfilePageDetails>[] = []
    for (const outcome of allFetchOutcomes) {
      if (!outcome.success) continue
      try {
        const data = parseProfilePage(outcome.html)
        parseOutcomes.push({ success: true, target: outcome.target, data })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const parseError: PipelineError = {
          code: "PROFILE_PARSE_FAILED",
          provider: "1001dj",
          step: "profile-parse",
          target: sanitizeForError(outcome.target),
          message: sanitizeForError(message),
        }
        errors.push(parseError)
        parseOutcomes.push({ success: false, target: outcome.target, error: parseError })
      }
    }

    // ── 4. Merge listing + profile data ──────────────────────────
    const { merged, errors: mergeErrors } = merge(listings, parseOutcomes)
    errors.push(...mergeErrors)

    // ── 5. Normalize to ServiceProfile<"wedding-dj"> ────────────
    const profiles: ServiceProfile<"wedding-dj">[] = []
    for (const parsed of merged) {
      try {
        profiles.push(normalizeForWeddingDj(parsed, opts.budgetTarget, opts.budgetMax))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push({
          code: "NORMALIZE_FAILED",
          provider: "1001dj",
          step: "normalize",
          target: parsed.listing.url,
          message: sanitizeForError(message),
        })
      }
    }

    return { profiles, profileCount: profiles.length, errors }
  }
}
