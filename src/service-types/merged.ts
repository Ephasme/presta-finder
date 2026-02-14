import type { CommonProfileFields, OfferCore } from "./core.js"
import type {
  MergedServiceTypeId,
  OfferDetailsByServiceType,
  ServiceSpecificByServiceType,
} from "./service-type-type-maps.js"

export type ServiceOffer<T extends MergedServiceTypeId> = OfferCore & {
  details: OfferDetailsByServiceType[T]
}

export type ServiceProfile<T extends MergedServiceTypeId> = CommonProfileFields & {
  serviceType: T
  offers: ServiceOffer<T>[]
  serviceSpecific: ServiceSpecificByServiceType[T]
}

export type AnyServiceOffer = {
  [K in MergedServiceTypeId]: ServiceOffer<K>
}[MergedServiceTypeId]

export type AnyServiceProfile = {
  [K in MergedServiceTypeId]: ServiceProfile<K>
}[MergedServiceTypeId]
