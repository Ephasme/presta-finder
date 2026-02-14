import type { PipelineError, ProfileParseOutcome } from "../types.js"
import type { VendorProfile } from "./normalize.js"
import type { ParsedProfilePage } from "../profile-page.js"
import type { ParsedMariagesnetVendor } from "./types.js"

export const merge = (
  listings: VendorProfile[],
  profileOutcomes: ProfileParseOutcome<ParsedProfilePage>[],
): { merged: ParsedMariagesnetVendor[]; errors: PipelineError[] } => {
  const errors: PipelineError[] = []
  const profileByUrl = new Map<string, ParsedProfilePage>()
  const profileByVendorId = new Map<string, ParsedProfilePage>()

  // Index profile pages by URL (primary), vendor_id from URL (fallback)
  for (const outcome of profileOutcomes) {
    if (!outcome.success) {
      errors.push(outcome.error)
      continue
    }
    const { target, data } = outcome
    profileByUrl.set(target, data)

    // Extract vendor_id from URL for fallback lookup
    // Typical Mariages.net URL: https://www.mariages.net/dj-mariage/dj-wedding--e12345
    const vendorIdMatch = /--e(\d+)(?:[?#]|$)/.exec(target)
    if (vendorIdMatch) {
      const vendorId = vendorIdMatch[1]
      if (vendorId) {
        profileByVendorId.set(vendorId, data)
      }
    }
  }

  const merged: ParsedMariagesnetVendor[] = []

  for (const listing of listings) {
    // Try primary join key: storefront_url
    let profilePage = listing.storefront_url
      ? (profileByUrl.get(listing.storefront_url) ?? null)
      : null

    // Fallback: vendor_id
    if (!profilePage && listing.vendor_id) {
      profilePage = profileByVendorId.get(listing.vendor_id) ?? null
    }

    // If still no match, include listing-only (no error — this is expected when profile fetch fails)
    merged.push({
      listing,
      profilePage,
    })
  }

  return { merged, errors }
}
