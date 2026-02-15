import type { ProviderCapability, SearchContext } from "../../service-types/types.js"
import type { AnyServiceProfile } from "../../service-types/merged.js"
import type {
  PipelineError,
  Provider,
  ProviderListOptions,
  ProviderListResult,
} from "../types.js"
import type { ProfileTask } from "../../pipeline/types.js"
import type { ParsedProfilePage } from "../profile-page.js"
import { collectRecommendationIds, fetchProfileBatches, fetchProfilePage } from "./fetch.js"
import { parseListingProfiles } from "./parse.js"
import { parseLinkabandProfilePage } from "./parse-profile.js"
import { normalizeForWeddingDj } from "./normalize-profile-for-wedding-dj.js"

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

  async list(opts: ProviderListOptions, context: SearchContext): Promise<ProviderListResult> {
    const errors: PipelineError[] = []
    if (opts.dryRun) {
      return { tasks: [], listingCount: 0, errors }
    }

    const log = (message: string): void => {
      opts.verbose?.("linkaband", message)
    }

    const authToken = process.env.LINKABAND_API_KEY
    if (!authToken) {
      throw new Error("LINKABAND_API_KEY is required for Linkaband")
    }

    const lat = context.location.lat ?? 48.98
    const lng = context.location.lng ?? 1.98
    const dateFrom = context.date.from ?? "01-06-2025"
    const dateTo = context.date.to ?? "30-09-2025"
    log(
      `list start (serviceType=${context.serviceType}, lat=${lat}, lng=${lng}, dateFrom=${dateFrom}, dateTo=${dateTo}, fetchLimit=${opts.fetchLimit ?? "none"})`,
    )

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
    log(`recommendations stage done (artistIds=${artistIds.length})`)

    if (artistIds.length === 0) {
      throw new Error("No artist IDs returned by Linkaband recommendations")
    }

    // ── 2. Fetch profile batches (listing stage) ─────────────────
    const profileRecords = await fetchProfileBatches(opts.cacheService, artistIds, authToken, {
      fetchLimit: opts.fetchLimit,
      signal: opts.signal,
      verbose: opts.verbose,
    })
    log(`profile batch stage done (rawRecords=${profileRecords.length})`)
    const listings = parseListingProfiles(profileRecords)
    log(`listing parse done (parsedListings=${listings.length})`)

    const targets = listings.slice(0, opts.fetchLimit)

    // ── 3. Create one ProfileTask per listing entry ──────────────
    const tasks: ProfileTask[] = targets.map((listing) => ({
      provider: "linkaband",
      displayName: "Linkaband",
      dedupKey: JSON.stringify(["linkaband", listing.slug]),
      target: listing.slug,
      execute: async (signal?: AbortSignal): Promise<AnyServiceProfile> => {
        // Fetch profile page (graceful failure -> profilePage = null)
        let profilePage: ParsedProfilePage | null = null
        try {
          const outcome = await fetchProfilePage(opts.cacheService, listing.slug, {
            signal,
            verbose: opts.verbose,
          })
          if (outcome.success) {
            profilePage = parseLinkabandProfilePage(outcome.html)
          }
        } catch {
          // fetch or parse failed -> listing-only profile
        }

        // Normalize (listing data always available, profilePage may be null)
        return normalizeForWeddingDj(
          { listing, profilePage },
          opts.budgetTarget,
          opts.budgetMax,
        )
      },
    }))

    return { tasks, listingCount: listings.length, errors }
  }
}
