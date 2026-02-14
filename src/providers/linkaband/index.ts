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
import { collectRecommendationIds, fetchProfileBatches, fetchProfilePage } from "./fetch.js"
import { parseListingProfiles } from "./parse.js"
import { parseLinkabandProfilePage } from "./parse-profile.js"
import type { ParsedProfilePage } from "../profile-page.js"
import { merge } from "./merge.js"
import { normalizeForWeddingDj } from "./normalize-profile-for-wedding-dj.js"

const CHUNK_SIZE = 50
const PROFILE_DELAY_MS = 30

export class LinkabandProvider implements Provider {
  readonly name = "linkaband" as const
  readonly displayName = "Linkaband"

  readonly capabilities: readonly ProviderCapability[] = [
    {
      serviceTypeId: "wedding-dj",
      searchParams: { landingType: "mariage", artistTypes: ["dj"] },
    },
  ]

  isAvailable(): boolean {
    return Boolean(process.env.LINKABAND_API_KEY)
  }

  async run(opts: ProviderRunOptions, context: SearchContext): Promise<ProviderRunResult> {
    const errors: PipelineError[] = []
    if (opts.dryRun) {
      return { profiles: [], profileCount: 0, errors }
    }

    const authToken = process.env.LINKABAND_API_KEY
    if (!authToken) {
      throw new Error("LINKABAND_API_KEY is required for Linkaband")
    }

    const lat = context.location.lat ?? 48.98
    const lng = context.location.lng ?? 1.98
    const dateFrom = context.date.from ?? "01-06-2025"
    const dateTo = context.date.to ?? "30-09-2025"

    // ── 1. Collect recommendation IDs ────────────────────────────
    const artistIds = await collectRecommendationIds(
      opts.cacheService,
      {
        longitude: lng,
        latitude: lat,
        dateFrom,
        dateTo,
        landingType: "mariage",
        artistTypes: ["dj"],
      },
      { fetchLimit: opts.fetchLimit, signal: opts.signal, verbose: opts.verbose },
    )

    if (artistIds.length === 0) {
      throw new Error("No artist IDs returned by Linkaband recommendations")
    }

    // ── 2. Fetch profile batches (listing stage) ─────────────────
    const profileRecords = await fetchProfileBatches(opts.cacheService, artistIds, authToken, {
      fetchLimit: opts.fetchLimit,
      signal: opts.signal,
    })
    const listings = parseListingProfiles(profileRecords)

    // ── 3. Profile page fetch (chunked, non-fatal per URL) ───────
    const targets = listings.map((listing) => listing.slug).slice(0, opts.fetchLimit)

    const allFetchOutcomes: ProfileFetchOutcome[] = []
    const limit = pLimit(opts.profileConcurrency)

    for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
      throwIfAborted(opts.signal)
      const chunk = targets.slice(i, i + CHUNK_SIZE)

      const chunkResults = await Promise.all(
        chunk.map((slug) =>
          limit(async (): Promise<ProfileFetchOutcome> => {
            try {
              const outcome = await fetchProfilePage(opts.cacheService, slug, {
                signal: opts.signal,
              })
              await sleep(PROFILE_DELAY_MS, opts.signal)
              return outcome
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              const url = `https://linkaband.com/${slug}`
              return {
                success: false,
                target: url,
                error: {
                  code: "PROFILE_FETCH_FAILED",
                  provider: "linkaband",
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

    // ── 4. Parse profile pages (non-fatal per page) ──────────────
    const parseOutcomes: ProfileParseOutcome<ParsedProfilePage>[] = []
    for (const outcome of allFetchOutcomes) {
      if (!outcome.success) continue
      try {
        const data = parseLinkabandProfilePage(outcome.html)
        parseOutcomes.push({ success: true, target: outcome.target, data })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const parseError: PipelineError = {
          code: "PROFILE_PARSE_FAILED",
          provider: "linkaband",
          step: "profile-parse",
          target: sanitizeForError(outcome.target),
          message: sanitizeForError(message),
        }
        errors.push(parseError)
        parseOutcomes.push({ success: false, target: outcome.target, error: parseError })
      }
    }

    // ── 5. Merge listing + profile data ──────────────────────────
    const { merged, errors: mergeErrors } = merge(listings, parseOutcomes)
    errors.push(...mergeErrors)

    // ── 6. Normalize to ServiceProfile<"wedding-dj"> ────────────
    const profiles: ServiceProfile<"wedding-dj">[] = []
    for (const parsed of merged) {
      try {
        profiles.push(normalizeForWeddingDj(parsed, opts.budgetTarget, opts.budgetMax))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push({
          code: "NORMALIZE_FAILED",
          provider: "linkaband",
          step: "normalize",
          target: `https://linkaband.com/${parsed.listing.slug}`,
          message: sanitizeForError(message),
        })
      }
    }

    return { profiles, profileCount: profiles.length, errors }
  }
}
