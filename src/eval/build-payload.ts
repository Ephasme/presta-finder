import type { AnyServiceProfile } from "../service-types/merged.js"
import { profileTitle } from "./profile-title.js"

interface EvaluationSignals {
  has_price: boolean
  price_min: number | null
  price_max: number | null
  rating_value: number | null
  rating_count: number | null
  has_location: boolean
  has_photos: boolean
  has_videos: boolean
  budget_fit: "good" | "ok" | "bad" | "unknown"
}

export interface EvaluationPayload {
  profile_title: string
  service_profile: AnyServiceProfile
  signals: EvaluationSignals
}

export const buildProfilePayload = (profile: AnyServiceProfile): EvaluationPayload => {
  const priceMin = profile.budgetSummary.minKnownPrice
  const priceMax = profile.budgetSummary.maxKnownPrice

  return {
    profile_title: profileTitle(profile),
    service_profile: profile,
    signals: {
      has_price: profile.budgetSummary.hasTransparentPricing,
      price_min: priceMin,
      price_max: priceMax,
      rating_value: profile.reputation.rating,
      rating_count: profile.reputation.reviewCount,
      has_location: Boolean(profile.location.city || profile.location.region),
      has_photos: profile.media.photosCount > 0,
      has_videos: profile.media.videosCount > 0,
      budget_fit: profile.budgetSummary.budgetFit,
    },
  }
}
