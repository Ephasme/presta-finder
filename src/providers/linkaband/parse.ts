import { z } from "zod"

import { SCHEMA_VERSION, type ParsedOutput, validateParsedOutput } from "../../schema/validate.js"
import { buildResultItem, parseArtist } from "./normalize.js"

const linkabandArtistsPayloadSchema = z.union([
  z.array(z.record(z.string(), z.unknown())),
  z.object({ artists: z.array(z.record(z.string(), z.unknown())) }).loose(),
])

const extractArtists = (payload: unknown): Record<string, unknown>[] => {
  const parsed = linkabandArtistsPayloadSchema.safeParse(payload)
  if (!parsed.success) {
    return []
  }
  if (Array.isArray(parsed.data)) {
    return parsed.data
  }
  return parsed.data.artists
}

export const parseListingProfiles = (
  payload: unknown,
): import("./normalize.js").ArtistProfile[] => {
  const artistsRaw = extractArtists(payload)
  const artists = artistsRaw.flatMap((item) => {
    try {
      return [parseArtist(item)]
    } catch {
      return []
    }
  })
  return artists
}

export const parseLinkaband = (payload: unknown): ParsedOutput => {
  const artists = parseListingProfiles(payload)

  return validateParsedOutput({
    meta: {
      website: "linkaband",
      kind: "profiles",
      count: artists.length,
      generatedAt: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
    },
    results: artists.map(buildResultItem),
    raw: payload,
  })
}
