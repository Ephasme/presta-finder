import { isRecord } from "../utils/type-guards.js"
import type { BudgetFit, CommonProfileFields } from "../service-types/core.js"
import type { ServiceOffer } from "../service-types/merged.js"
import type {
  MergedServiceTypeId,
  OfferDetailsByServiceType,
} from "../service-types/service-type-type-maps.js"
import type { BudgetUnit } from "../service-types/types.js"

/** Minimal input for buildCommonProfile — each provider maps its ParsedProviderProfile to this. */
export interface CommonProfileInput {
  provider: string
  providerId: string | null
  name: string | null
  profileUrl: string | null
  description: string | null
  city: string | null
  region: string | null
  ratingValue: number | null
  ratingCount: number | null
  pricingMin: number | null
  pricingMax: number | null
  pricingCurrency: string | null
  imageUrls: string[]
  videoUrls: string[]
}

interface CommonProfileOverrides {
  isVerified?: boolean | null
  responseTime?: string | null
  travelPolicy?: string | null
  contractProvided?: boolean | null
  reviewHighlights?: string[]
  serviceArea?: string[]
}

export const asRecord = (value: unknown): Record<string, unknown> | null =>
  isRecord(value) ? value : null

export const toStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : []

export const parseDelimitedList = (value: unknown): string[] => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return []
  }
  return value
    .split(/[,\n;/|-]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

export const computeBudgetFit = (
  minKnownPrice: number | null,
  maxKnownPrice: number | null,
  budgetTarget: number,
  budgetMax: number,
): BudgetFit => {
  const bestKnownPrice = minKnownPrice ?? maxKnownPrice
  if (bestKnownPrice === null) {
    return "unknown"
  }
  if (bestKnownPrice <= budgetTarget) {
    return "good"
  }
  if (bestKnownPrice <= budgetMax) {
    return "ok"
  }
  return "bad"
}

export const buildCommonProfile = (
  input: CommonProfileInput,
  budgetTarget: number,
  budgetMax: number,
  overrides: CommonProfileOverrides = {},
): CommonProfileFields => {
  const defaultServiceArea = input.city ? [input.city] : []

  return {
    provider: input.provider,
    providerId: input.providerId,
    name: input.name,
    profileUrl: input.profileUrl,
    description: input.description,
    reputation: {
      rating: input.ratingValue,
      reviewCount: input.ratingCount,
      reviewHighlights: overrides.reviewHighlights ?? [],
    },
    location: {
      city: input.city,
      region: input.region,
      serviceArea: overrides.serviceArea ?? defaultServiceArea,
      travelPolicy: overrides.travelPolicy ?? null,
    },
    availability: {
      availableDates: [],
      leadTimeDays: null,
      bookingStatus: null,
    },
    professionalism: {
      isVerified: overrides.isVerified ?? null,
      yearsExperience: null,
      responseTime: overrides.responseTime ?? null,
      contractProvided: overrides.contractProvided ?? null,
      insurance: null,
    },
    media: {
      photosCount: input.imageUrls.length,
      videosCount: input.videoUrls.length,
      portfolioLinks: input.imageUrls,
    },
    communication: {
      languages: [],
      responseChannels: [],
    },
    policies: {
      cancellationPolicy: null,
      requirements: [],
    },
    budgetSummary: {
      minKnownPrice: input.pricingMin,
      maxKnownPrice: input.pricingMax,
      hasTransparentPricing: input.pricingMin !== null || input.pricingMax !== null,
      budgetFit: computeBudgetFit(input.pricingMin, input.pricingMax, budgetTarget, budgetMax),
    },
  }
}

export const buildSingleOffer = <T extends MergedServiceTypeId>(
  input: CommonProfileInput,
  details: OfferDetailsByServiceType[T],
  unit: BudgetUnit = "total",
): ServiceOffer<T>[] => {
  const bestKnownPrice = input.pricingMin ?? input.pricingMax
  if (bestKnownPrice === null) {
    return []
  }

  return [
    {
      offerId: input.providerId ?? `${input.provider}:default`,
      name: "Base offer",
      basePrice: {
        amount: bestKnownPrice,
        currency: input.pricingCurrency,
        unit,
      },
      details,
    },
  ]
}
