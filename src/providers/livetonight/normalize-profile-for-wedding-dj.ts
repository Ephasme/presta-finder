import type { ServiceProfile } from "../../service-types/types.js"
import {
  buildCommonProfile,
  buildSingleOffer,
  type CommonProfileInput,
  toStringArray,
} from "../service-profile-shared.js"
import type { ParsedLiveTonightProfile } from "./types.js"

const toCommonInput = (parsed: ParsedLiveTonightProfile): CommonProfileInput => {
  const city = parsed.listing.address?.includes(",")
    ? (parsed.listing.address.split(",")[0]?.trim() ?? null)
    : null

  const videoUrls = parsed.listing.videos
    .map((video) => video.link)
    .filter((value): value is string => typeof value === "string" && value.length > 0)

  return {
    provider: "livetonight",
    providerId: String(parsed.listing.profile_id),
    name: parsed.listing.band_name ?? parsed.listing.name,
    profileUrl: parsed.listing.slug
      ? `https://www.livetonight.fr/groupe-musique-dj/${parsed.listing.profile_id}-${parsed.listing.slug}`
      : null,
    city,
    region: null,
    ratingValue: parsed.profilePage?.ratingValue ?? parsed.listing.rating,
    ratingCount: parsed.profilePage?.ratingCount ?? parsed.listing.musician_reviews_count,
    pricingMin: parsed.profilePage?.pricingMin ?? parsed.listing.price,
    pricingMax: parsed.profilePage?.pricingMax ?? null,
    pricingCurrency:
      parsed.profilePage?.pricingCurrency ?? (parsed.listing.price !== null ? "EUR" : null),
    imageUrls: [
      parsed.listing.picture,
      parsed.listing.cover,
      parsed.listing.picture_mobile,
      parsed.profilePage?.imageUrl,
    ].filter((url): url is string => typeof url === "string" && url.length > 0),
    videoUrls,
  }
}

export const normalizeForWeddingDj = (
  parsed: ParsedLiveTonightProfile,
  budgetTarget: number,
  budgetMax: number,
): ServiceProfile<"wedding-dj"> => {
  const input = toCommonInput(parsed)
  const isVerified = typeof parsed.listing.approved === "boolean" ? parsed.listing.approved : null
  const contractProvided =
    typeof parsed.listing.contracts_public === "boolean" ? parsed.listing.contracts_public : null

  return {
    ...buildCommonProfile(input, budgetTarget, budgetMax, {
      isVerified,
      contractProvided,
    }),
    serviceType: "wedding-dj",
    offers: buildSingleOffer(input, {
      includedEquipment: [],
      optionalExtras: [],
      mandatoryFees: [],
      conditions: [],
    }),
    serviceSpecific: {
      musicalStyles: toStringArray(parsed.listing.categories),
      djSetFormats: [],
      mcServices: null,
      soundEquipment: [],
      lightingEquipment: [],
      specialMomentsSupport: [],
    },
  }
}
