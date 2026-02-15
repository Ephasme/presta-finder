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
import { parseListingPages } from "./parse.js"
import { parseMariagesnetProfilePage } from "./parse-profile.js"
import { normalizeForWeddingDj } from "./normalize-profile-for-wedding-dj.js"

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

  async list(opts: ProviderListOptions, context: SearchContext): Promise<ProviderListResult> {
    const errors: PipelineError[] = []
    if (opts.dryRun) {
      return { tasks: [], listingCount: 0, errors }
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
      return { tasks: [], listingCount: 0, errors }
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
      return { tasks: [], listingCount: 0, errors }
    }

    const idGrupo =
      typeof capability.searchParams.idGrupo === "number" ? capability.searchParams.idGrupo : 2
    const idSector =
      typeof capability.searchParams.idSector === "number" ? capability.searchParams.idSector : 9

    const brightdataApiKey = process.env.BRIGHTDATA_API_KEY ?? null
    const brightdataZone = process.env.BRIGHTDATA_WEB_UNLOCKER_ZONE ?? null

    // ── 1. Listing fetch + parse ────────────────────────────────────
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

    // Only include listings with a storefront URL
    const targets = listings
      .filter((vendor): vendor is typeof vendor & { storefront_url: string } =>
        Boolean(vendor.storefront_url),
      )
      .slice(0, opts.fetchLimit)

    // ── 2. Create one ProfileTask per listing entry ─────────────────
    const tasks: ProfileTask[] = targets.map((listing) => ({
      provider: "mariagesnet",
      displayName: "Mariages.net",
      dedupKey: JSON.stringify(["mariagesnet", listing.storefront_url]),
      target: listing.storefront_url,
      execute: async (signal?: AbortSignal): Promise<AnyServiceProfile> => {
        // Fetch profile page (graceful failure -> profilePage = null)
        let profilePage: ParsedProfilePage | null = null
        try {
          log(`profile fetch start (${listing.storefront_url})`)
          const outcome = await fetchProfilePage(
            opts.cacheService,
            listing.storefront_url,
            brightdataApiKey,
            brightdataZone,
            { signal },
          )
          if (outcome.success) {
            profilePage = parseMariagesnetProfilePage(outcome.html)
            log(`profile fetch done (${listing.storefront_url}, bytes=${outcome.html.length})`)
          } else {
            log(`profile fetch failed (${listing.storefront_url}, message=${outcome.error.message})`)
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
