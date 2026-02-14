import type { BudgetUnit } from "./types.js"

export interface OfferPrice {
  amount: number | null
  currency: string | null
  unit: BudgetUnit
}

export interface OfferCore {
  offerId: string
  name: string
  basePrice: OfferPrice
}

export type BudgetFit = "good" | "ok" | "bad" | "unknown"

export interface BudgetSummary {
  minKnownPrice: number | null
  maxKnownPrice: number | null
  hasTransparentPricing: boolean
  budgetFit: BudgetFit
}

export interface ProfileReputation {
  rating: number | null
  reviewCount: number | null
  reviewHighlights: string[]
}

export interface ProfileLocation {
  city: string | null
  region: string | null
  serviceArea: string[]
  travelPolicy: string | null
}

export interface ProfileAvailability {
  availableDates: string[]
  leadTimeDays: number | null
  bookingStatus: string | null
}

export interface ProfileProfessionalism {
  isVerified: boolean | null
  yearsExperience: number | null
  responseTime: string | null
  contractProvided: boolean | null
  insurance: boolean | null
}

export interface ProfileMedia {
  photosCount: number
  videosCount: number
  portfolioLinks: string[]
}

export interface ProfileCommunication {
  languages: string[]
  responseChannels: string[]
}

export interface ProfilePolicies {
  cancellationPolicy: string | null
  requirements: string[]
}

export interface CommonProfileFields {
  provider: string
  providerId: string | null
  name: string | null
  profileUrl: string | null
  reputation: ProfileReputation
  location: ProfileLocation
  availability: ProfileAvailability
  professionalism: ProfileProfessionalism
  media: ProfileMedia
  communication: ProfileCommunication
  policies: ProfilePolicies
  budgetSummary: BudgetSummary
}
