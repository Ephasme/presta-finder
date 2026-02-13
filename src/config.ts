import { config as loadDotEnv } from "dotenv"

loadDotEnv()

export interface EnvConfig {
  openaiApiKey: string | null
  linkabandApiKey: string | null
  brightdataApiKey: string | null
  brightdataZone: string | null
}

export const readEnvConfig = (): EnvConfig => ({
  openaiApiKey: process.env.OPENAI_API_KEY ?? null,
  linkabandApiKey: process.env.LINKABAND_API_KEY ?? null,
  brightdataApiKey: process.env.BRIGHTDATA_API_KEY ?? null,
  brightdataZone: process.env.BRIGHTDATA_WEB_UNLOCKER_ZONE ?? null,
})
