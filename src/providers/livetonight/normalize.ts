import { makeLocation, makeMedia, makeNormalizedResult, makePricing, makeRatings, makeSource, type ResultItem } from "../../schema/normalized.js"
import { coerceFloat, coerceInt } from "../../utils/coerce.js"

export interface UserProfile {
  profile_id: number
  band_name: string | null
  name: string | null
  slug: string | null
  description: string | null
  rating: number | null
  musician_reviews_count: number | null
  price: number | null
  categories: string[]
  address: string | null
  secondary_address: string | null
  picture: string | null
  cover: string | null
  picture_mobile: string | null
  videos: Record<string, unknown>[]
  approved: boolean | null
  prime: boolean | null
  not_prime: boolean | null
  contracts_public: boolean | null
  onboarding_status: string | null
  raw: Record<string, unknown>
}

export interface AggregationsResult {
  index: string
  aggregations: Record<string, unknown>
  values: Record<string, unknown> | null
  raw: Record<string, unknown>
}

export const parseUser = (raw: Record<string, unknown>): UserProfile => {
  const profileId = raw.id
  if (typeof profileId !== "number" || !Number.isInteger(profileId)) {
    throw new Error("id missing or invalid")
  }
  const categories = Array.isArray(raw.categories)
    ? raw.categories.filter((value): value is string => typeof value === "string")
    : []
  return {
    profile_id: profileId,
    band_name: typeof raw.band_name === "string" ? raw.band_name : null,
    name: typeof raw.name === "string" ? raw.name : null,
    slug: typeof raw.slug === "string" ? raw.slug : null,
    description: typeof raw.description === "string" ? raw.description : null,
    rating: coerceFloat(raw.rating),
    musician_reviews_count: coerceInt(raw.musician_reviews_count),
    price: coerceFloat(raw.price),
    categories,
    address: typeof raw.address === "string" ? raw.address : null,
    secondary_address: typeof raw.secondary_address === "string" ? raw.secondary_address : null,
    picture: typeof raw.picture === "string" ? raw.picture : null,
    cover: typeof raw.cover === "string" ? raw.cover : null,
    picture_mobile: typeof raw.picture_mobile === "string" ? raw.picture_mobile : null,
    videos: Array.isArray(raw.videos)
      ? raw.videos.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object")
      : [],
    approved: typeof raw.approved === "boolean" ? raw.approved : null,
    prime: typeof raw.prime === "boolean" ? raw.prime : null,
    not_prime: typeof raw.not_prime === "boolean" ? raw.not_prime : null,
    contracts_public: typeof raw.contracts_public === "boolean" ? raw.contracts_public : null,
    onboarding_status: typeof raw.onboarding_status === "string" ? raw.onboarding_status : null,
    raw,
  }
}

export const parseAggregations = (
  index: string,
  aggregations: Record<string, unknown>,
  values: Record<string, unknown> | null,
): AggregationsResult => ({
  index,
  aggregations,
  values,
  raw: aggregations,
})

const splitCityCountry = (text: string | null): { city: string | null; country: string | null } => {
  if (!text || !text.includes(",")) {
    return { city: null, country: null }
  }
  const parts = text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 2) {
    return { city: parts[0] ?? null, country: parts[1] ?? null }
  }
  return { city: null, country: null }
}

export const normalizeUser = (user: UserProfile) => {
  const name = user.band_name ?? user.name
  const split = splitCityCountry(user.address)
  const videoUrls = user.videos
    .map((video) => video.link)
    .filter((value): value is string => typeof value === "string" && value.length > 0)

  return makeNormalizedResult({
    website: "livetonight",
    kind: "profile",
    sourceId: user.profile_id,
    name,
    slug: user.slug,
    description: user.description,
    location: makeLocation({
      text: user.address,
      city: split.city,
      country: split.country,
    }),
    ratings: makeRatings({
      value: user.rating,
      count: user.musician_reviews_count,
    }),
    pricing: makePricing({
      min: user.price,
      raw: user.price,
    }),
    categories: user.categories.length ? user.categories : null,
    tags: null,
    media: makeMedia({
      image_url: user.picture,
      cover_urls: [user.cover, user.picture_mobile].filter((value): value is string => Boolean(value)),
      video_urls: videoUrls.length ? videoUrls : null,
    }),
    source: makeSource({
      slug: user.slug,
      origin: "api",
    }),
    flags: {
      approved: user.approved,
      prime: user.prime,
      not_prime: user.not_prime,
    },
    metrics: {
      reviews_count: user.musician_reviews_count,
    },
    attributes: {
      secondary_address: user.secondary_address,
      contracts_public: user.contracts_public,
      onboarding_status: user.onboarding_status,
    },
  })
}

export const normalizeAggregations = (aggs: AggregationsResult) =>
  makeNormalizedResult({
    website: "livetonight",
    kind: "aggregation",
    sourceId: null,
    location: makeLocation(),
    ratings: makeRatings(),
    pricing: makePricing(),
    categories: null,
    tags: null,
    media: makeMedia(),
    source: makeSource({
      index: aggs.index,
      origin: "api",
    }),
    attributes: {
      aggregations: aggs.aggregations,
      values: aggs.values,
    },
  })

export const buildProfileItem = (user: UserProfile): ResultItem => ({
  kind: "profile",
  normalized: normalizeUser(user),
  raw: user.raw,
})

export const buildAggregationItem = (aggs: AggregationsResult): ResultItem => ({
  kind: "aggregation",
  normalized: normalizeAggregations(aggs),
  raw: aggs.raw,
})
