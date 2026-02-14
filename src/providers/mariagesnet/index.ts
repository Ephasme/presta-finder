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

    const log = (message: string): void => {
      opts.verbose?.("mariagesnet", message)
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
    log(
      `listing stage start (serviceType=${context.serviceType}, idGrupo=${idGrupo}, idSector=${idSector}, fetchLimit=${opts.fetchLimit ?? "none"})`,
    )
    const listingResponses = await fetchListingPages(
      opts.cacheService,
      idGrupo,
      idSector,
      brightdataApiKey,
      brightdataZone,
      { fetchLimit: opts.fetchLimit, signal: opts.signal, verbose: opts.verbose },
    )
    const listings = parseListingPages(listingResponses)
    log(`listing stage done (responses=${listingResponses.length}, vendors=${listings.length})`)

    // ── 2. Profile fetch (chunked, non-fatal per URL) ────────────
    const targets = listings
      .map((vendor) => vendor.storefront_url)
      .filter((url): url is string => Boolean(url))
      .slice(0, opts.fetchLimit)
    const allFetchOutcomes: ProfileFetchOutcome[] = []
    const limit = pLimit(opts.profileConcurrency)
    const totalChunks = Math.ceil(targets.length / CHUNK_SIZE)
    const totalTargets = targets.length
    let completed = 0
    log(
      `profile fetch stage start (targets=${targets.length}, concurrency=${opts.profileConcurrency}, chunkSize=${CHUNK_SIZE})`,
    )

    if (totalTargets > 0) {
      opts.onProgress?.(0, totalTargets)
    }

    for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
      throwIfAborted(opts.signal)
      const chunk = targets.slice(i, i + CHUNK_SIZE)
      const chunkIndex = Math.floor(i / CHUNK_SIZE) + 1
      log(`profile fetch chunk start (${chunkIndex}/${totalChunks}, size=${chunk.length})`)

      const chunkResults = await Promise.all(
        chunk.map((url) =>
          limit(async (): Promise<ProfileFetchOutcome> => {
            let outcome: ProfileFetchOutcome
            try {
              log(`profile fetch start (${url})`)
              outcome = await fetchProfilePage(
                opts.cacheService,
                url,
                brightdataApiKey,
                brightdataZone,
                { signal: opts.signal },
              )
              if (outcome.success) {
                log(`profile fetch done (${url}, bytes=${outcome.html.length})`)
              } else {
                log(`profile fetch failed (${url}, message=${outcome.error.message})`)
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              log(`profile fetch exception (${url}, message=${message})`)
              outcome = {
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
            await sleep(PROFILE_DELAY_MS, opts.signal)
            completed += 1
            opts.onProgress?.(completed, totalTargets)
            return outcome
          }),
        ),
      )

      allFetchOutcomes.push(...chunkResults)
      const successCount = chunkResults.filter((outcome) => outcome.success).length
      log(
        `profile fetch chunk done (${chunkIndex}/${totalChunks}, success=${successCount}, failed=${chunkResults.length - successCount})`,
      )
    }

    // Collect fetch errors
    for (const outcome of allFetchOutcomes) {
      if (!outcome.success) {
        errors.push(outcome.error)
      }
    }

    // ── 3. Parse profile pages (non-fatal per page) ──────────────
    log(`profile parse stage start (pages=${allFetchOutcomes.length})`)
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
    const parsedCount = parseOutcomes.filter((outcome) => outcome.success).length
    log(
      `profile parse stage done (success=${parsedCount}, failed=${parseOutcomes.length - parsedCount})`,
    )

    // ── 4. Merge listing + profile data ──────────────────────────
    const targetSet = new Set(targets)
    const limitedListings = listings.filter((listing) =>
      listing.storefront_url ? targetSet.has(listing.storefront_url) : false,
    )
    log(
      `merge stage start (listings=${limitedListings.length}/${listings.length}, parsed=${parsedCount})`,
    )
    const { merged, errors: mergeErrors } = merge(limitedListings, parseOutcomes)
    errors.push(...mergeErrors)
    log(`merge stage done (merged=${merged.length}, errors=${mergeErrors.length})`)

    // ── 5. Normalize to ServiceProfile<"wedding-dj"> ────────────
    log(`normalize stage start (merged=${merged.length})`)
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
    log(`normalize stage done (profiles=${profiles.length}, errors=${errors.length})`)

    return {
      profiles,
      profileCount: profiles.length,
      listingCount: listings.length,
      fetchedCount: totalTargets,
      fetchLimit: opts.fetchLimit,
      errors,
    }
  }
}
