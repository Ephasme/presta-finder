import { fetchAndParseLinkaband } from "./fetch.js"
import type { CliContext, Provider, ProviderFetchOptions, ProviderResult } from "../types.js"

export class LinkabandProvider implements Provider {
  readonly name = "linkaband" as const
  readonly displayName = "Linkaband"
  readonly outputFile = "profiles_linkaband.json"

  isAvailable(): boolean {
    return Boolean(process.env.LINKABAND_API_KEY)
  }

  async fetch(opts: ProviderFetchOptions, context: CliContext): Promise<ProviderResult> {
    if (!this.isAvailable() && !opts.dryRun) {
      return { success: false, profileCount: 0 }
    }

    const profileCount = await fetchAndParseLinkaband({
      outputFile: opts.outputFile,
      dryRun: opts.dryRun,
      lat: context.linkabandLat,
      lng: context.linkabandLng,
      dateFrom: context.linkabandDateFrom,
      dateTo: context.linkabandDateTo,
      authToken: process.env.LINKABAND_API_KEY ?? null,
      fetchLimit: opts.fetchLimit,
      profileConcurrency: opts.profileConcurrency,
      onFetchProgress: opts.onFetchProgress,
      verbose: opts.verbose,
      signal: opts.signal,
    })
    return { success: true, profileCount }
  }
}
