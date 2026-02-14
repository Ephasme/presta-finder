import type { PipelineError, ProfileParseOutcome } from "../types.js"
import type { UserProfile } from "./normalize.js"
import type { ParsedProfilePage } from "../profile-page.js"
import type { ParsedLiveTonightProfile } from "./types.js"

export const merge = (
  listings: UserProfile[],
  profileOutcomes: ProfileParseOutcome<ParsedProfilePage>[],
): { merged: ParsedLiveTonightProfile[]; errors: PipelineError[] } => {
  const errors: PipelineError[] = []
  const profileByUrl = new Map<string, ParsedProfilePage>()
  const profileById = new Map<number, ParsedProfilePage>()
  const profileBySlug = new Map<string, ParsedProfilePage>()

  // Index profile pages by URL (primary), id (fallback 1), slug (fallback 2)
  for (const outcome of profileOutcomes) {
    if (!outcome.success) {
      errors.push(outcome.error)
      continue
    }
    const { target, data } = outcome
    profileByUrl.set(target, data)

    // Extract profile_id from URL for fallback lookup
    const profileIdMatch = /\/(\d+)-/.exec(target)
    if (profileIdMatch) {
      const profileId = Number.parseInt(profileIdMatch[1], 10)
      if (!Number.isNaN(profileId)) {
        profileById.set(profileId, data)
      }
    }

    // Extract slug from URL for fallback lookup
    const slugMatch = /-([^/]+)$/.exec(target)
    if (slugMatch?.[1]) {
      profileBySlug.set(slugMatch[1], data)
    }
  }

  const merged: ParsedLiveTonightProfile[] = []

  for (const listing of listings) {
    const expectedUrl = `https://www.livetonight.fr/groupe-musique-dj/${listing.profile_id}-${listing.slug}`

    // Try primary join key: URL
    let profilePage = profileByUrl.get(expectedUrl) ?? null

    // Fallback 1: profile_id
    if (!profilePage) {
      profilePage = profileById.get(listing.profile_id) ?? null
    }

    // Fallback 2: slug
    if (!profilePage && listing.slug) {
      profilePage = profileBySlug.get(listing.slug) ?? null
    }

    // If still no match, include listing-only (no error — this is expected when profile fetch fails)
    merged.push({
      listing,
      profilePage,
    })
  }

  return { merged, errors }
}
