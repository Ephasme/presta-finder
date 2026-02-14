/**
 * Runtime type guard: checks that `value` is a non-null, non-array plain object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Narrows `value` to `Record<string, unknown>` or returns an empty object.
 * Use when a fallback is acceptable (e.g. optional nested objects).
 */
export function toRecordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

/**
 * Narrows `value` to `Record<string, unknown>` or returns `null`.
 */
export function toRecordOrNull(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}
