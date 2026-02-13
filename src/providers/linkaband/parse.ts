import { SCHEMA_VERSION, type ParsedOutput, validateParsedOutput } from "../../schema/validate.js"
import { buildResultItem, parseArtist } from "./normalize.js"

const extractArtists = (payload: unknown): Record<string, unknown>[] => {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
  }
  if (payload && typeof payload === "object") {
    const artists = (payload as Record<string, unknown>).artists
    if (Array.isArray(artists)) {
      return artists.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    }
  }
  return []
}

export const parseLinkaband = (payload: unknown): ParsedOutput => {
  const artistsRaw = extractArtists(payload)
  const artists = artistsRaw.flatMap((item) => {
    try {
      return [parseArtist(item)]
    } catch {
      return []
    }
  })

  return validateParsedOutput({
    meta: {
      website: "linkaband",
      kind: "profiles",
      count: artists.length,
      generatedAt: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
    },
    results: artists.map(buildResultItem),
    raw: null,
  })
}
