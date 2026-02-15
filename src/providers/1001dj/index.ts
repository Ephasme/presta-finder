import type { ProviderCapability, SearchContext } from "../../service-types/types.js"
import type { AnyServiceProfile } from "../../service-types/merged.js"
import type {
  PipelineError,
  Provider,
  ProviderListOptions,
  ProviderListResult,
} from "../types.js"
import type { ProfileTask } from "../../pipeline/types.js"
import { DEFAULT_ENDPOINT, fetchListingPages, fetchProfilePage } from "./fetch.js"
import { parseListingPages } from "./parse-list.js"
import { parseProfilePage, type ProfilePageDetails } from "./parse-profile.js"
import { normalizeForWeddingDj } from "./normalize-profile-for-wedding-dj.js"

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

  async list(opts: ProviderListOptions, _context: SearchContext): Promise<ProviderListResult> {
    const errors: PipelineError[] = []
    if (opts.dryRun) {
      return { tasks: [], listingCount: 0, errors }
    }

    // ── 1. Listing fetch + parse ────────────────────────────────────
    const listingHtmlPages = await fetchListingPages(
      opts.cacheService,
      { typeEvent: "mariage" },
      { fetchLimit: opts.fetchLimit, signal: opts.signal, verbose: opts.verbose },
    )
    const listings = parseListingPages(listingHtmlPages)
    const targets = listings.slice(0, opts.fetchLimit)

    // ── 2. Create one ProfileTask per listing entry ─────────────────
    const tasks: ProfileTask[] = targets.map((listing) => ({
      provider: "1001dj",
      displayName: "1001dj",
      dedupKey: JSON.stringify(["1001dj", listing.url]),
      target: listing.url,
      execute: async (signal?: AbortSignal): Promise<AnyServiceProfile> => {
        // Fetch profile page (graceful failure -> profilePage = null)
        let profilePage: ProfilePageDetails | null = null
        try {
          const outcome = await fetchProfilePage(opts.cacheService, listing.url, {
            referer: DEFAULT_ENDPOINT,
            signal,
          })
          if (outcome.success) {
            profilePage = parseProfilePage(outcome.html)
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
