import { randomUUID } from "node:crypto"
import type { AnyServiceProfile } from "../service-types/merged.js"

/**
 * Deduplication key for a service profile.
 *
 * Priority:
 * 1. provider + providerId (if providerId is non-null)
 * 2. provider + profileUrl (if providerId is null but profileUrl is non-null)
 * 3. UUID (fallback to prevent silent data loss when both are null)
 */
const profileKey = (profile: AnyServiceProfile): string => {
  if (profile.providerId !== null) {
    return JSON.stringify([profile.provider, profile.providerId])
  }
  if (profile.profileUrl !== null) {
    return JSON.stringify([profile.provider, "url", profile.profileUrl])
  }
  // Fallback: generate a unique key to preserve both profiles
  return randomUUID()
}

/**
 * Merge profiles from multiple providers, deduplicating by provider + providerId.
 *
 * Profiles with null providerId fall back to profileUrl for deduplication.
 * If both are null, profiles are kept (UUID fallback prevents data loss).
 */
export const mergeProfiles = (profileArrays: AnyServiceProfile[][]): AnyServiceProfile[] => {
  const merged: AnyServiceProfile[] = []
  const seen = new Set<string>()

  for (const profiles of profileArrays) {
    for (const profile of profiles) {
      const key = profileKey(profile)
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      merged.push(profile)
    }
  }

  return merged
}
