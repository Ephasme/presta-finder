export interface KidsEntertainerOfferDetails {
  optionalExtras: string[]
  mandatoryFees: string[]
  conditions: string[]
}

export interface AgeRange {
  min: number
  max: number
}

export interface KidsEntertainerServiceSpecific {
  ageRange: AgeRange | null
  activityTypes: string[]
  groupSizeRange: string | null
  sessionDurationOptions: string[]
  safetyCertifications: string[]
  backgroundCheck: boolean | null
  materialsIncluded: boolean | null
  indoorOutdoorSupport: string[]
}
