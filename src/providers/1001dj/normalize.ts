import {
  makeLocation,
  makeMedia,
  makeNormalizedResult,
  makePricing,
  makeRatings,
  makeSource,
  type ResultItem,
} from "../../schema/normalized.js"

export interface ItemListEntry {
  position: number | null
  profile_id: number | null
  name: string | null
  url: string
  price_range: unknown
  offer_low_price: number | null
  offer_high_price: number | null
  offer_currency: string | null
  image_url: string | null
  latitude: number | null
  longitude: number | null
  street_address: string | null
  address_locality: string | null
  postal_code: string | null
  address_region: string | null
  address_country: string | null
  rating_count: number | null
  rating_value: number | null
  worst_rating: number | null
  best_rating: number | null
  source: string
  raw_item: Record<string, unknown> | null
}

const slugFromUrl = (url: string): string | null => {
  const match = /\/profil-dj-\d+-([^./]+)\.htm/.exec(url)
  return match?.[1] ?? null
}

export const buildProfile = (entry: ItemListEntry) => {
  const slug = slugFromUrl(entry.url)
  const locationParts = [
    entry.address_locality,
    entry.address_region,
    entry.address_country,
  ].filter((v): v is string => Boolean(v))
  const locationText = locationParts.length ? locationParts.join(", ") : null

  return makeNormalizedResult({
    website: "1001dj",
    kind: "profile",
    sourceId: entry.profile_id,
    name: entry.name,
    url: entry.url,
    slug,
    description: null,
    location: makeLocation({
      text: locationText,
      street_address: entry.street_address,
      city: entry.address_locality,
      postcode: entry.postal_code,
      region: entry.address_region,
      country: entry.address_country,
      latitude: entry.latitude,
      longitude: entry.longitude,
    }),
    ratings: makeRatings({
      value: entry.rating_value,
      count: entry.rating_count,
      best: entry.best_rating,
      worst: entry.worst_rating,
    }),
    pricing: makePricing({
      min: entry.offer_low_price,
      max: entry.offer_high_price,
      raw:
        entry.offer_low_price !== null ||
        entry.offer_high_price !== null ||
        entry.offer_currency !== null
          ? {
              price_range: entry.price_range,
              low_price: entry.offer_low_price,
              high_price: entry.offer_high_price,
              price_currency: entry.offer_currency,
            }
          : entry.price_range,
      currency: entry.offer_currency,
    }),
    categories: null,
    tags: null,
    media: makeMedia({ image_url: entry.image_url }),
    source: makeSource({
      url: entry.url,
      slug,
      position: entry.position,
      origin: entry.source,
    }),
    flags: null,
    metrics: null,
    attributes: null,
  })
}

export const buildResultItem = (entry: ItemListEntry): ResultItem => ({
  kind: "profile",
  normalized: buildProfile(entry),
  raw: entry.raw_item,
})
