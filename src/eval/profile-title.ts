import type { AnyServiceProfile } from "../service-types/merged.js"

/**
 * Generate a human-readable title for a profile, used in evaluation payloads and reports.
 *
 * Format: "Name (Provider)" or just "Provider" if name is null.
 */
export const profileTitle = (profile: AnyServiceProfile): string => {
  const providerLabel = profile.provider.charAt(0).toUpperCase() + profile.provider.slice(1)
  return profile.name ? `${profile.name} (${providerLabel})` : providerLabel
}
