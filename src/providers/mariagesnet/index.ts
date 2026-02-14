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
import { parseListingPages } from "./parse.js"
import { parseMariagesnetProfilePage } from "./parse-profile.js"
import type { ParsedProfilePage } from "../profile-page.js"
import { merge } from "./merge.js"
import { normalizeForWeddingDj } from "./normalize-profile-for-wedding-dj.js"

const CHUNK_SIZE = 50
const PROFILE_DELAY_MS = 30

export class MariagesnetProvider implements Provider {
  readonly name = "mariagesnet" as const
  readonly displayName = "Mariages.net"

  readonly capabilities: readonly ProviderCapability[] = [
    {
      serviceTypeId: "wedding-dj",
      searchParams: { idGrupo: 2, idSector: 9 },
    },
  ]

  isAvailable(): boolean {
    return (
      Boolean(process.env.BRIGHTDATA_API_KEY) && Boolean(process.env.BRIGHTDATA_WEB_UNLOCKER_ZONE)
    )
  }

  async run(opts: ProviderRunOptions, context: SearchContext): Promise<ProviderRunResult> {
    const errors: PipelineError[] = []
    if (opts.dryRun) {
      return { profiles: [], profileCount: 0, errors }
    }

    if (!this.isAvailable()) {
      errors.push({
        code: "LISTING_FETCH_FAILED",
        provider: "mariagesnet",
        step: "listing-fetch",
        target: null,
        message: "BRIGHTDATA_API_KEY and BRIGHTDATA_WEB_UNLOCKER_ZONE required",
      })
      return { profiles: [], profileCount: 0, errors }
    }

    const capability = this.capabilities.find((c) => c.serviceTypeId === context.serviceType)
    if (!capability) {
      errors.push({
        code: "LISTING_FETCH_FAILED",
        provider: "mariagesnet",
        step: "listing-fetch",
        target: null,
        message: `No capability for service type ${context.serviceType}`,
      })
      return { profiles: [], profileCount: 0, errors }
    }

    const idGrupo =
      typeof capability.searchParams.idGrupo === "number" ? capability.searchParams.idGrupo : 2
    const idSector =
      typeof capability.searchParams.idSector === "number" ? capability.searchParams.idSector : 9

    const brightdataApiKey = process.env.BRIGHTDATA_API_KEY ?? null
    const brightdataZone = process.env.BRIGHTDATA_WEB_UNLOCKER_ZONE ?? null

    // ── 1. Listing fetch + parse (fatal on failure) ──────────────
    const listingResponses = await fetchListingPages(
      opts.cacheService,
      idGrupo,
      idSector,
      brightdataApiKey,
      brightdataZone,
      { fetchLimit: opts.fetchLimit, signal: opts.signal, verbose: opts.verbose },
    )
    const listings = parseListingPages(listingResponses)

    // ── 2. Profile fetch (chunked, non-fatal per URL) ────────────
    const targets = listings
      .map((vendor) => vendor.storefront_url)
      .filter((url): url is string => Boolean(url))
      .slice(0, opts.fetchLimit)
    const allFetchOutcomes: ProfileFetchOutcome[] = []
    const limit = pLimit(opts.profileConcurrency)

    for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
      throwIfAborted(opts.signal)
      const chunk = targets.slice(i, i + CHUNK_SIZE)

      const chunkResults = await Promise.all(
        chunk.map((url) =>
          limit(async (): Promise<ProfileFetchOutcome> => {
            try {
              const outcome = await fetchProfilePage(
                opts.cacheService,
                url,
                brightdataApiKey,
                brightdataZone,
                { signal: opts.signal },
              )
              await sleep(PROFILE_DELAY_MS, opts.signal)
              return outcome
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              return {
                success: false,
                target: url,
                error: {
                  code: "PROFILE_FETCH_FAILED",
                  provider: "mariagesnet",
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
        const data = parseMariagesnetProfilePage(outcome.html)
        parseOutcomes.push({ success: true, target: outcome.target, data })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const parseError: PipelineError = {
          code: "PROFILE_PARSE_FAILED",
          provider: "mariagesnet",
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
          provider: "mariagesnet",
          step: "normalize",
          target: parsed.listing.storefront_url ?? parsed.listing.vendor_id,
          message: sanitizeForError(message),
        })
      }
    }

    return { profiles, profileCount: profiles.length, errors }
  }
}
