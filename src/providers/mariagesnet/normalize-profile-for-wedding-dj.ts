import type { ServiceProfile } from "../../service-types/types.js"
import {
  buildCommonProfile,
  buildSingleOffer,
  type CommonProfileInput,
  parseDelimitedList,
} from "../service-profile-shared.js"
import type { ParsedMariagesnetVendor } from "./types.js"

const extractCity = (vendor: ParsedMariagesnetVendor): string | null => {
  if (typeof vendor.listing.address.city === "string") {
    return vendor.listing.address.city
  }
  // Fallback: parse location_text (e.g., "Paris, Île-de-France, France")
  if (vendor.listing.location_text) {
    const parts = vendor.listing.location_text.split(",").map((p) => p.trim())
    return parts[0] ?? null
  }
  return null
}

const extractRegion = (vendor: ParsedMariagesnetVendor): string | null => {
  if (typeof vendor.listing.address.region === "string") {
    return vendor.listing.address.region
  }
  // Fallback: parse location_text
  if (vendor.listing.location_text) {
    const parts = vendor.listing.location_text.split(",").map((p) => p.trim())
    return parts[1] ?? null
  }
  return null
}

const collectImageUrls = (vendor: ParsedMariagesnetVendor): string[] => {
  const urls: string[] = []

  // Gallery images from listing
  for (const item of vendor.listing.gallery) {
    for (const [key, value] of Object.entries(item)) {
      if (key.startsWith("src") && typeof value === "string" && value.length > 0) {
        urls.push(value)
      }
    }
  }

  // Profile page image if available
  if (vendor.profilePage?.imageUrl) {
    urls.push(vendor.profilePage.imageUrl)
  }

  return urls.filter((url, idx, arr) => arr.indexOf(url) === idx) // dedupe
}

const toCommonInput = (parsed: ParsedMariagesnetVendor): CommonProfileInput => ({
  provider: "mariagesnet",
  providerId: parsed.listing.vendor_id,
  name: parsed.listing.name,
  profileUrl: parsed.listing.storefront_url,
  city: extractCity(parsed),
  region: extractRegion(parsed),
  ratingValue: parsed.profilePage?.ratingValue ?? parsed.listing.rating,
  ratingCount: parsed.profilePage?.ratingCount ?? parsed.listing.reviews_count,
  pricingMin: parsed.profilePage?.pricingMin ?? parsed.listing.starting_price_value,
  pricingMax: parsed.profilePage?.pricingMax ?? null,
  pricingCurrency: parsed.profilePage?.pricingCurrency ?? parsed.listing.currency,
  imageUrls: collectImageUrls(parsed),
  videoUrls: [],
})

export const normalizeForWeddingDj = (
  parsed: ParsedMariagesnetVendor,
  budgetTarget: number,
  budgetMax: number,
): ServiceProfile<"wedding-dj"> => {
  const input = toCommonInput(parsed)
  const musicalStyles = parsed.listing.sector ? parseDelimitedList(parsed.listing.sector) : []

  return {
    ...buildCommonProfile(input, budgetTarget, budgetMax),
    serviceType: "wedding-dj",
    offers: buildSingleOffer(input, {
      includedEquipment: [],
      optionalExtras: [],
      mandatoryFees: [],
      conditions: [],
    }),
    serviceSpecific: {
      musicalStyles,
      djSetFormats: [],
      mcServices: null,
      soundEquipment: [],
      lightingEquipment: [],
      specialMomentsSupport: [],
    },
  }
}
