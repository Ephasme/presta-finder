import { Dj1001Provider } from "./1001dj/index.js"
import { LinkabandProvider } from "./linkaband/index.js"
import { LiveTonightProvider } from "./livetonight/index.js"
import { MariagesnetProvider } from "./mariagesnet/index.js"

export const ALL_PROVIDERS = [
  new Dj1001Provider(),
  new LinkabandProvider(),
  new LiveTonightProvider(),
  new MariagesnetProvider(),
] as const

export type ProviderName = (typeof ALL_PROVIDERS)[number]["name"]

const PROVIDER_NAME_SET = new Set<string>(ALL_PROVIDERS.map((p) => p.name))

export const isProviderName = (value: string): value is ProviderName => PROVIDER_NAME_SET.has(value)
