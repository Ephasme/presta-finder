export interface CatererOfferDetails {
  menuFormat: "buffet" | "seated" | "cocktail" | null
  dietaryOptions: string[]
  optionalExtras: string[]
  mandatoryFees: string[]
  conditions: string[]
}

export interface CatererServiceSpecific {
  foodStyles: string[]
  cuisineTypes: string[]
  dietaryOptions: string[]
  menuFormats: string[]
  tastingAvailable: boolean | null
  serviceStaffIncluded: boolean | null
  tablewareIncluded: boolean | null
  kitchenRequirements: string[]
}
