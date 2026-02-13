import { fetchAndParse1001dj } from "./fetch.js"
import type { Provider, ProviderFetchOptions, ProviderResult } from "../types.js"

export class Dj1001Provider implements Provider {
  readonly name = "1001dj" as const
  readonly displayName = "1001dj"
  readonly outputFile = "profiles_1001dj.json"

  isAvailable(): boolean {
    return true
  }

  async fetch(opts: ProviderFetchOptions): Promise<ProviderResult> {
    const profileCount = await fetchAndParse1001dj({
      outputFile: opts.outputFile,
      dryRun: opts.dryRun,
      fetchLimit: opts.fetchLimit,
      profileConcurrency: opts.profileConcurrency,
      onFetchProgress: opts.onFetchProgress,
      verbose: opts.verbose,
      signal: opts.signal,
    })
    return { success: true, profileCount }
  }
}
