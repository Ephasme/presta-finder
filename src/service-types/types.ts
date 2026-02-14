export type ServiceTypeId = "wedding-dj" | "kids-entertainer"

export type BudgetUnit = "total" | "per_person" | "hourly"

export interface ServiceTypeConfig {
  id: ServiceTypeId
  label: string
  budgetUnit: BudgetUnit
  defaultBudgetTarget?: number
  defaultBudgetMax?: number
}

export interface ProviderCapability {
  serviceTypeId: ServiceTypeId
  /** Provider-specific search parameters for this service type (e.g. categories, landing types). */
  searchParams: Record<string, unknown>
}

export interface SearchLocation {
  text: string | null
  lat: number | null
  lng: number | null
  city: string | null
  postcode: string | null
  department: string | null
  region: string | null
  country: string | null
}

export interface SearchDateRange {
  from: string | null
  to: string | null
}

export interface SearchContext {
  serviceType: ServiceTypeId
  location: SearchLocation
  date: SearchDateRange
}

export const makeSearchLocation = (overrides: Partial<SearchLocation> = {}): SearchLocation => ({
  text: null,
  lat: null,
  lng: null,
  city: null,
  postcode: null,
  department: null,
  region: null,
  country: null,
  ...overrides,
})

export const makeSearchDateRange = (overrides: Partial<SearchDateRange> = {}): SearchDateRange => ({
  from: null,
  to: null,
  ...overrides,
})

export type { CommonProfileFields, OfferCore, OfferPrice } from "./core.js"
export type {
  MergedServiceTypeId,
  OfferDetailsByServiceType,
  ServiceSpecificByServiceType,
} from "./service-type-type-maps.js"
export type { AnyServiceOffer, AnyServiceProfile, ServiceOffer, ServiceProfile } from "./merged.js"
