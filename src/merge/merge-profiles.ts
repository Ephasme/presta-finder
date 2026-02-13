import { readFile, writeFile } from "node:fs/promises"

import { type NormalizedProfile } from "../schema/normalized.js"
import { SCHEMA_VERSION, extractProfilesFromResults, type ParsedOutput, validateParsedOutput } from "../schema/validate.js"

const profileKey = (profile: NormalizedProfile): string =>
  JSON.stringify([
    profile.website ?? null,
    profile.id ?? null,
    profile.slug ?? null,
    profile.url ?? null,
    profile.name ?? null,
  ])

export const mergeProfiles = async (paths: string[]): Promise<NormalizedProfile[]> => {
  const merged: NormalizedProfile[] = []
  const seen = new Set<string>()

  for (const path of paths) {
    try {
      const content = await readFile(path, "utf-8")
      const parsed = JSON.parse(content) as unknown
      const profiles = extractProfilesFromResults(parsed)
      for (const profile of profiles) {
        const key = profileKey(profile)
        if (seen.has(key)) {
          continue
        }
        seen.add(key)
        merged.push(profile)
      }
    } catch {
      continue
    }
  }
  return merged
}

export const buildMergedOutput = (profiles: NormalizedProfile[]): ParsedOutput => {
  const sources = Array.from(
    new Set(
      profiles
        .map((profile) => profile.website)
        .filter((website): website is string => typeof website === "string" && website.length > 0),
    ),
  ).sort()

  return validateParsedOutput({
    meta: {
      website: "consolidated",
      kind: "profiles",
      count: profiles.length,
      generatedAt: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
      sources,
    },
    results: profiles.map((profile) => ({
      kind: "profile",
      normalized: profile,
      raw: null,
    })),
    raw: null,
  })
}

export const writeMergedOutput = async (outputPath: string, profiles: NormalizedProfile[]): Promise<void> => {
  const payload = buildMergedOutput(profiles)
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8")
}
