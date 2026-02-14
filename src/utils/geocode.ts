import { z } from "zod"
import { httpGetJson, mergeHeaders } from "./http.js"

const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search"
const USER_AGENT = "PrestaFinder/1.0"
const DEFAULT_TIMEOUT_MS = 10_000

export interface GeocodedLocation {
  lat: number
  lng: number
  text: string
}

const nominatimResultSchema = z.object({
  lat: z.string(),
  lon: z.string(),
  display_name: z.string(),
})

const nominatimResponseSchema = z.array(nominatimResultSchema)

const LAT_LNG_RE = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/

/**
 * Parse a direct "lat,lng" input (e.g. "48.8566,2.3522").
 * Returns null if the input does not match the expected format.
 */
export const parseLatLng = (input: string): GeocodedLocation | null => {
  const match = LAT_LNG_RE.exec(input.trim())
  if (!match) {
    return null
  }
  const lat = Number(match[1])
  const lng = Number(match[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null
  }
  return { lat, lng, text: input.trim() }
}

/**
 * Geocode a location string using the OpenStreetMap Nominatim API.
 * Accepts either a city name (e.g. "Paris") or direct "lat,lng" coordinates.
 *
 * Falls back to direct lat,lng parsing if the input matches the pattern,
 * bypassing the API call entirely.
 */
export const geocode = async (input: string, signal?: AbortSignal): Promise<GeocodedLocation> => {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new Error("Location cannot be empty")
  }

  // Try direct lat,lng parsing first to avoid unnecessary API calls
  const directParsed = parseLatLng(trimmed)
  if (directParsed) {
    return directParsed
  }

  // Call Nominatim API
  const url = `${NOMINATIM_ENDPOINT}?${new URLSearchParams({
    q: trimmed,
    format: "json",
    limit: "1",
  }).toString()}`

  const response = await httpGetJson(
    url,
    DEFAULT_TIMEOUT_MS,
    mergeHeaders(
      {
        accept: "application/json",
        "user-agent": USER_AGENT,
      },
      {},
    ),
    signal,
  )

  const results = nominatimResponseSchema.parse(response.body)

  if (results.length === 0) {
    throw new Error(
      `Geocoding failed: no results for "${trimmed}". ` +
        `Try using direct coordinates instead (e.g. "48.8566,2.3522").`,
    )
  }

  const result = results[0]
  const lat = Number(result.lat)
  const lng = Number(result.lon)

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error(
      `Geocoding returned invalid coordinates for "${trimmed}". ` +
        `Try using direct coordinates instead (e.g. "48.8566,2.3522").`,
    )
  }

  return {
    lat,
    lng,
    text: result.display_name,
  }
}
