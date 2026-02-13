import { fetchAndParseLiveTonight } from "./fetch.js"
import type { CliContext, Provider, ProviderFetchOptions, ProviderResult } from "../types.js"

export class LiveTonightProvider implements Provider {
  readonly name = "livetonight" as const
  readonly displayName = "LiveTonight"
  readonly outputFile = "profiles_livetonight.json"

  isAvailable(): boolean {
    return true
  }

  async fetch(opts: ProviderFetchOptions, context: CliContext): Promise<ProviderResult> {
    const profileCount = await fetchAndParseLiveTonight({
      outputFile: opts.outputFile,
      dryRun: opts.dryRun,
      categories: context.livetonightCategories,
      fetchLimit: opts.fetchLimit,
      profileConcurrency: opts.profileConcurrency,
      onFetchProgress: opts.onFetchProgress,
      verbose: opts.verbose,
      signal: opts.signal,
    })
    return { success: true, profileCount }
  }
}
