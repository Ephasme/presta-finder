import type { NormalizedProfile } from "../schema/normalized.js"
import { coerceFloat, coerceInt } from "../utils/coerce.js"

export interface EvaluationPayload {
  profile: {
    website: string
    id: unknown
    name: string | null
    url: string | null
    slug: string | null
    description: string | null
    location: NormalizedProfile["location"]
    ratings: NormalizedProfile["ratings"]
    pricing: NormalizedProfile["pricing"]
    categories: NormalizedProfile["categories"]
    tags: NormalizedProfile["tags"]
    media: NormalizedProfile["media"]
    flags: NormalizedProfile["flags"]
    metrics: NormalizedProfile["metrics"]
    attributes: NormalizedProfile["attributes"]
    source: NormalizedProfile["source"]
  }
  signals: {
    has_price: boolean
    price_min: number | null
    price_max: number | null
    rating_value: number | null
    rating_count: number | null
    has_location: boolean
    has_description: boolean
    has_media: boolean
  }
  budget: {
    target_eur: number
    max_eur: number
  }
}

const listHasEntries = (value: unknown): boolean => Array.isArray(value) && value.length > 0

export const buildProfilePayload = (
  profile: NormalizedProfile,
  budgetTarget: number,
  budgetMax: number,
): EvaluationPayload => {
  const location = profile.location
  const ratings = profile.ratings
  const pricing = profile.pricing
  const media = profile.media
  const source = profile.source

  const priceMin = coerceFloat(pricing.min)
  const priceMax = coerceFloat(pricing.max)
  const ratingValue = coerceFloat(ratings.value)
  const ratingCount = coerceInt(ratings.count)

  return {
    profile: {
      website: profile.website,
      id: profile.id,
      name: profile.name,
      url: profile.url ?? source.url ?? null,
      slug: profile.slug ?? source.slug ?? null,
      description: profile.description,
      location,
      ratings,
      pricing,
      categories: profile.categories,
      tags: profile.tags,
      media,
      flags: profile.flags,
      metrics: profile.metrics,
      attributes: profile.attributes,
      source,
    },
    signals: {
      has_price: priceMin !== null || priceMax !== null,
      price_min: priceMin,
      price_max: priceMax,
      rating_value: ratingValue,
      rating_count: ratingCount,
      has_location: Boolean(location.text || location.city || location.postcode || location.region || location.country),
      has_description: Boolean(profile.description),
      has_media: Boolean(
        media.image_url || listHasEntries(media.cover_urls) || listHasEntries(media.gallery_urls) || listHasEntries(media.video_urls),
      ),
    },
    budget: {
      target_eur: budgetTarget,
      max_eur: budgetMax,
    },
  }
}
