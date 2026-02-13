export type QueryValue = string | number | boolean | null | undefined

export type QueryParams = Record<string, QueryValue | QueryValue[]>

export const buildUrl = (base: string, params: QueryParams): string => {
  const qs = new URLSearchParams()
  for (const [key, rawValue] of Object.entries(params)) {
    if (Array.isArray(rawValue)) {
      for (const value of rawValue) {
        if (value === null || value === undefined) {
          continue
        }
        qs.append(key, String(value))
      }
      continue
    }
    if (rawValue === null || rawValue === undefined) {
      continue
    }
    qs.append(key, String(rawValue))
  }
  const query = qs.toString()
  return query ? `${base}?${query}` : base
}
