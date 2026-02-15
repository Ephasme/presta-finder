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
import { fetchListingPages, fetchProfilePage } from "./fetch.js"
import { parseLiveTonightListingResponse } from "./parse.js"
import { parseLiveTonightProfilePage } from "./parse-profile.js"
import { normalizeForWeddingDj } from "./normalize-profile-for-wedding-dj.js"

export class LiveTonightProvider implements Provider {
  readonly name = "livetonight" as const
  readonly displayName = "LiveTonight"

  readonly capabilities: readonly ProviderCapability[] = [
    {
      serviceTypeId: "wedding-dj",
      searchParams: {},
    },
  ]

  isAvailable(): boolean {
    return true
  }

  async list(opts: ProviderListOptions, _context: SearchContext): Promise<ProviderListResult> {
    const errors: PipelineError[] = []
    if (opts.dryRun) {
      return { tasks: [], listingCount: 0, errors }
    }

    // ── 1. Listing fetch + parse ────────────────────────────────────
    const listingJsonPages = await fetchListingPages(opts.cacheService, {
      fetchLimit: opts.fetchLimit,
      signal: opts.signal,
      verbose: opts.verbose,
    })

    const listings = listingJsonPages.flatMap((jsonPage) =>
      parseLiveTonightListingResponse(jsonPage),
    )

    // Only include listings with a slug (needed for profile page URL)
    const targets = listings
      .filter((listing): listing is typeof listing & { slug: string } => listing.slug !== null)
      .slice(0, opts.fetchLimit)

    // ── 2. Create one ProfileTask per listing entry ─────────────────
    const tasks: ProfileTask[] = targets.map((listing) => {
      const url = `https://www.livetonight.fr/groupe-musique-dj/${listing.profile_id}-${listing.slug}`
      return {
        provider: "livetonight",
        displayName: "LiveTonight",
        dedupKey: JSON.stringify(["livetonight", url]),
        target: url,
        execute: async (signal?: AbortSignal): Promise<AnyServiceProfile> => {
          // Fetch profile page (graceful failure -> profilePage = null)
          let profilePage: ParsedProfilePage | null = null
          try {
            const outcome = await fetchProfilePage(opts.cacheService, listing.profile_id, listing.slug, {
              signal,
            })
            if (outcome.success) {
              profilePage = parseLiveTonightProfilePage(outcome.html)
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
      }
    })

    return { tasks, listingCount: listings.length, errors }
  }
}
