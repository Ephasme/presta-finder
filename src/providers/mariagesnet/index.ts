import { fetchAndParseMariagesnet } from "./fetch.js"
import type { Provider, ProviderFetchOptions, ProviderResult } from "../types.js"

export class MariagesnetProvider implements Provider {
  readonly name = "mariagesnet" as const
  readonly displayName = "Mariages.net"
  readonly outputFile = "profiles_mariagesnet.json"

  isAvailable(): boolean {
    return (
      Boolean(process.env.BRIGHTDATA_API_KEY) && Boolean(process.env.BRIGHTDATA_WEB_UNLOCKER_ZONE)
    )
  }

  async fetch(opts: ProviderFetchOptions): Promise<ProviderResult> {
    if (!this.isAvailable() && !opts.dryRun) {
      return { success: false, profileCount: 0 }
    }
    const profileCount = await fetchAndParseMariagesnet({
      outputFile: opts.outputFile,
      dryRun: opts.dryRun,
      brightdataApiKey: process.env.BRIGHTDATA_API_KEY ?? null,
      brightdataZone: process.env.BRIGHTDATA_WEB_UNLOCKER_ZONE ?? null,
      fetchLimit: opts.fetchLimit,
      profileConcurrency: opts.profileConcurrency,
      onFetchProgress: opts.onFetchProgress,
      verbose: opts.verbose,
      signal: opts.signal,
    })
    return { success: true, profileCount }
  }
}
