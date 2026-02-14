export interface DecoratorOfferDetails {
  optionalExtras: string[]
  mandatoryFees: string[]
  conditions: string[]
}

export interface DecoratorServiceSpecific {
  decorationStyles: string[]
  specialties: string[]
  setupTeardownIncluded: boolean | null
  rentalCatalog: string[]
  customDesignLevel: "template" | "semi-custom" | "bespoke" | null
  venueConstraintsHandled: string[]
  ecoFriendlyOptions: string[]
  moodboardProcess: boolean | null
}
