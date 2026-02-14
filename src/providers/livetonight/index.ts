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
import { fetchListingPages, fetchProfilePage } from "./fetch.js"
import { parseLiveTonightListingResponse } from "./parse.js"
import { parseLiveTonightProfilePage } from "./parse-profile.js"
import type { ParsedProfilePage } from "../profile-page.js"
import { merge } from "./merge.js"
import { normalizeForWeddingDj } from "./normalize-profile-for-wedding-dj.js"

const CHUNK_SIZE = 50
const PROFILE_DELAY_MS = 30

export class LiveTonightProvider implements Provider {
  readonly name = "livetonight" as const
  readonly displayName = "LiveTonight"

  readonly capabilities: readonly ProviderCapability[] = [
    {
      serviceTypeId: "wedding-dj",
      searchParams: { categories: ["DJ"], djFilter: "dj-wedding" },
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
    const listingJsonPages = await fetchListingPages(
      opts.cacheService,
      { categories: ["DJ"], djFilter: "dj-wedding" },
      { fetchLimit: opts.fetchLimit, signal: opts.signal, verbose: opts.verbose },
    )

    const listings = listingJsonPages.flatMap((jsonPage) =>
      parseLiveTonightListingResponse(jsonPage),
    )

    // ── 2. Profile fetch (chunked, non-fatal per URL) ────────────
    const targets = listings
      .filter((listing): listing is typeof listing & { slug: string } => listing.slug !== null)
      .map((listing) => ({ id: listing.profile_id, slug: listing.slug }))
      .slice(0, opts.fetchLimit)

    const allFetchOutcomes: ProfileFetchOutcome[] = []
    const limit = pLimit(opts.profileConcurrency)

    for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
      throwIfAborted(opts.signal)
      const chunk = targets.slice(i, i + CHUNK_SIZE)

      const chunkResults = await Promise.all(
        chunk.map(({ id, slug }) =>
          limit(async (): Promise<ProfileFetchOutcome> => {
            try {
              const outcome = await fetchProfilePage(opts.cacheService, id, slug, {
                signal: opts.signal,
              })
              await sleep(PROFILE_DELAY_MS, opts.signal)
              return outcome
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              const url = `https://www.livetonight.fr/groupe-musique-dj/${id}-${slug}`
              return {
                success: false,
                target: url,
                error: {
                  code: "PROFILE_FETCH_FAILED",
                  provider: "livetonight",
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
    const parseOutcomes: ProfileParseOutcome<ParsedProfilePage>[] = []
    for (const outcome of allFetchOutcomes) {
      if (!outcome.success) continue
      try {
        const data = parseLiveTonightProfilePage(outcome.html)
        parseOutcomes.push({ success: true, target: outcome.target, data })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const parseError: PipelineError = {
          code: "PROFILE_PARSE_FAILED",
          provider: "livetonight",
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
        const url = parsed.listing.slug
          ? `https://www.livetonight.fr/groupe-musique-dj/${parsed.listing.profile_id}-${parsed.listing.slug}`
          : String(parsed.listing.profile_id)
        errors.push({
          code: "NORMALIZE_FAILED",
          provider: "livetonight",
          step: "normalize",
          target: url,
          message: sanitizeForError(message),
        })
      }
    }

    return { profiles, profileCount: profiles.length, errors }
  }
}
