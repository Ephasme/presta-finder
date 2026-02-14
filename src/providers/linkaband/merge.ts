import type { PipelineError, ProfileParseOutcome } from "../types.js"
import type { ArtistProfile } from "./normalize.js"
import type { ParsedProfilePage } from "../profile-page.js"
import type { ParsedLinkabandArtist } from "./types.js"

export const merge = (
  listings: ArtistProfile[],
  profileOutcomes: ProfileParseOutcome<ParsedProfilePage>[],
): { merged: ParsedLinkabandArtist[]; errors: PipelineError[] } => {
  const errors: PipelineError[] = []
  const profileByUrl = new Map<string, ParsedProfilePage>()
  const profileById = new Map<number, ParsedProfilePage>()
  const profileBySlug = new Map<string, ParsedProfilePage>()

  // Index profile pages by URL (primary), artist ID (fallback 1), slug (fallback 2)
  for (const outcome of profileOutcomes) {
    if (!outcome.success) {
      errors.push(outcome.error)
      continue
    }
    const { target, data } = outcome
    profileByUrl.set(target, data)

    // Extract slug from URL for fallback lookup
    const slugMatch = /linkaband\.com\/([^/]+)$/.exec(target)
    if (slugMatch?.[1]) {
      const slug = decodeURIComponent(slugMatch[1])
      profileBySlug.set(slug, data)
    }
  }

  const merged: ParsedLinkabandArtist[] = []

  for (const listing of listings) {
    const expectedUrl = `https://linkaband.com/${encodeURIComponent(listing.slug)}`

    // Try primary join key: URL
    let profilePage = profileByUrl.get(expectedUrl) ?? null

    // Fallback 1: artist ID
    if (!profilePage) {
      profilePage = profileById.get(listing.profile_id) ?? null
    }

    // Fallback 2: slug
    if (!profilePage) {
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
