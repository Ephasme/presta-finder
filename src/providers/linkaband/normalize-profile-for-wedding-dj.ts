import type { ServiceProfile } from "../../service-types/types.js"
import {
  buildCommonProfile,
  buildSingleOffer,
  type CommonProfileInput,
  parseDelimitedList,
  toStringArray,
} from "../service-profile-shared.js"
import type { ParsedLinkabandArtist } from "./types.js"

const coverUrls = (covers: import("./normalize.js").ArtistProfile["cover_pictures"]): string[] => {
  const urls: string[] = []
  for (const cover of covers) {
    for (const url of [cover.url, cover.original, cover.url_bis]) {
      if (url) {
        urls.push(url)
      }
    }
  }
  return urls
}

const primaryPrice = (
  lowest: import("./normalize.js").ArtistProfile["lowest_formation"],
): number | null => {
  const prestation = lowest?.lowest_prestation
  return (
    prestation?.amount_full_ttc ?? prestation?.amount_one_brut ?? prestation?.amount_full_ht ?? null
  )
}

const toCommonInput = (parsed: ParsedLinkabandArtist): CommonProfileInput => {
  const listing = parsed.listing

  return {
    provider: "linkaband",
    providerId: String(listing.profile_id),
    name: listing.name,
    profileUrl: `https://linkaband.com/${listing.slug}`,
    city: listing.localisation.city,
    region: listing.departement_name,
    ratingValue: parsed.profilePage?.ratingValue ?? listing.global_rating,
    ratingCount: parsed.profilePage?.ratingCount ?? listing.nb_comments,
    pricingMin: parsed.profilePage?.pricingMin ?? primaryPrice(listing.lowest_formation),
    pricingMax: parsed.profilePage?.pricingMax ?? null,
    pricingCurrency: parsed.profilePage?.pricingCurrency ?? null,
    imageUrls: [
      listing.profile_picture.url,
      listing.profile_picture.original,
      listing.profile_picture.url_bis,
      ...coverUrls(listing.cover_pictures),
      parsed.profilePage?.imageUrl,
    ].filter((url): url is string => typeof url === "string" && url.length > 0),
    videoUrls: [],
  }
}

export const normalizeForWeddingDj = (
  parsed: ParsedLinkabandArtist,
  budgetTarget: number,
  budgetMax: number,
): ServiceProfile<"wedding-dj"> => {
  const input = toCommonInput(parsed)
  const listing = parsed.listing
  const material = listing.lowest_formation?.material
  const equipment = parseDelimitedList(material)

  return {
    ...buildCommonProfile(input, budgetTarget, budgetMax, {
      isVerified: listing.verified,
      responseTime: listing.response_time,
      travelPolicy: listing.facturation,
    }),
    serviceType: "wedding-dj",
    offers: buildSingleOffer(input, {
      includedEquipment: equipment,
      optionalExtras: [],
      mandatoryFees: [],
      conditions: [],
    }),
    serviceSpecific: {
      musicalStyles: toStringArray(listing.styles),
      djSetFormats: toStringArray(listing.players),
      mcServices: null,
      soundEquipment: equipment,
      lightingEquipment: [],
      specialMomentsSupport: [],
    },
  }
}
