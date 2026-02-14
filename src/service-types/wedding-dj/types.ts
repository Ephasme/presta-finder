export interface WeddingDjOfferDetails {
  includedEquipment: string[]
  optionalExtras: string[]
  mandatoryFees: string[]
  conditions: string[]
}

export interface WeddingDjServiceSpecific {
  musicalStyles: string[]
  djSetFormats: string[]
  mcServices: boolean | null
  soundEquipment: string[]
  lightingEquipment: string[]
  specialMomentsSupport: string[]
}
