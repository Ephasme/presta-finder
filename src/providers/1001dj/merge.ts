import type { PipelineError, ProfileParseOutcome } from "../types.js"
import type { ItemListEntry } from "./normalize.js"
import type { ProfilePageDetails } from "./parse-profile.js"
import type { Parsed1001DjProfile } from "./types.js"

const extractSlugFromUrl = (url: string): string | null => {
  const match = /\/profil-dj-\d+-([^./]+)\.htm/.exec(url)
  return match?.[1] ?? null
}

export const merge = (
  listings: ItemListEntry[],
  profileOutcomes: ProfileParseOutcome<ProfilePageDetails>[],
): { merged: Parsed1001DjProfile[]; errors: PipelineError[] } => {
  const errors: PipelineError[] = []
  const profileByUrl = new Map<string, ProfilePageDetails>()
  const profileByProfileId = new Map<number, ProfilePageDetails>()
  const profileBySlug = new Map<string, ProfilePageDetails>()

  // Index profile pages by URL (primary), profile_id (fallback 1), slug (fallback 2)
  for (const outcome of profileOutcomes) {
    if (!outcome.success) {
      errors.push(outcome.error)
      continue
    }
    const { target, data } = outcome
    profileByUrl.set(target, data)

    // Extract profile_id from URL for fallback lookup
    const profileIdMatch = /\/profil-dj-(\d+)-/.exec(target)
    if (profileIdMatch) {
      const profileId = Number.parseInt(profileIdMatch[1], 10)
      if (!Number.isNaN(profileId)) {
        profileByProfileId.set(profileId, data)
      }
    }

    // Extract slug from URL for fallback lookup
    const slug = extractSlugFromUrl(target)
    if (slug) {
      profileBySlug.set(slug, data)
    }
  }

  const merged: Parsed1001DjProfile[] = []

  for (const listing of listings) {
    // Try primary join key: URL
    let profilePage = profileByUrl.get(listing.url) ?? null

    // Fallback 1: profile_id
    if (!profilePage && listing.profile_id !== null) {
      profilePage = profileByProfileId.get(listing.profile_id) ?? null
    }

    // Fallback 2: slug
    if (!profilePage) {
      const slug = extractSlugFromUrl(listing.url)
      if (slug) {
        profilePage = profileBySlug.get(slug) ?? null
      }
    }

    // If still no match, include listing-only (no error — this is expected when profile fetch fails)
    merged.push({
      listing,
      profilePage,
    })
  }

  return { merged, errors }
}
