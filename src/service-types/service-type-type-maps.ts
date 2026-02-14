import type { CatererOfferDetails, CatererServiceSpecific } from "./caterer/types.js"
import type { DecoratorOfferDetails, DecoratorServiceSpecific } from "./decorator/types.js"
import type {
  KidsEntertainerOfferDetails,
  KidsEntertainerServiceSpecific,
} from "./kids-entertainer/types.js"
import type { WeddingDjOfferDetails, WeddingDjServiceSpecific } from "./wedding-dj/types.js"

export interface OfferDetailsByServiceType {
  "wedding-dj": WeddingDjOfferDetails
  caterer: CatererOfferDetails
  "kids-entertainer": KidsEntertainerOfferDetails
  decorator: DecoratorOfferDetails
}

export interface ServiceSpecificByServiceType {
  "wedding-dj": WeddingDjServiceSpecific
  caterer: CatererServiceSpecific
  "kids-entertainer": KidsEntertainerServiceSpecific
  decorator: DecoratorServiceSpecific
}

export type MergedServiceTypeId = keyof OfferDetailsByServiceType &
  keyof ServiceSpecificByServiceType
