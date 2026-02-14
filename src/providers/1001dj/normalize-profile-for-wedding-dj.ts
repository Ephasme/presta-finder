import type { ServiceProfile } from "../../service-types/types.js"
import {
  buildCommonProfile,
  buildSingleOffer,
  type CommonProfileInput,
} from "../service-profile-shared.js"
import type { Parsed1001DjProfile } from "./types.js"

const toCommonInput = (parsed: Parsed1001DjProfile): CommonProfileInput => ({
  provider: "1001dj",
  providerId: parsed.listing.profile_id !== null ? String(parsed.listing.profile_id) : null,
  name: parsed.listing.name,
  profileUrl: parsed.listing.url,
  city: parsed.listing.address_locality,
  region: parsed.listing.address_region,
  ratingValue: parsed.profilePage?.ratingValue ?? parsed.listing.rating_value,
  ratingCount: parsed.profilePage?.ratingCount ?? parsed.listing.rating_count,
  pricingMin: parsed.profilePage?.pricingMin ?? parsed.listing.offer_low_price,
  pricingMax: parsed.profilePage?.pricingMax ?? parsed.listing.offer_high_price,
  pricingCurrency: parsed.profilePage?.pricingCurrency ?? parsed.listing.offer_currency,
  imageUrls: [parsed.listing.image_url, parsed.profilePage?.imageUrl].filter(
    (url): url is string => typeof url === "string" && url.length > 0,
  ),
  videoUrls: [],
})

export const normalizeForWeddingDj = (
  parsed: Parsed1001DjProfile,
  budgetTarget: number,
  budgetMax: number,
): ServiceProfile<"wedding-dj"> => {
  const input = toCommonInput(parsed)
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
      musicalStyles: [],
      djSetFormats: [],
      mcServices: null,
      soundEquipment: [],
      lightingEquipment: [],
      specialMomentsSupport: [],
    },
  }
}
