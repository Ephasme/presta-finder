import type { PromptConfig } from "./prompt-types.js"
import type { ServiceTypeConfig, ServiceTypeId } from "./types.js"
import { weddingDjPromptConfig } from "./wedding-dj/prompt-parser.js"

const SERVICE_TYPE_CONFIGS: ReadonlyMap<ServiceTypeId, ServiceTypeConfig> = new Map<
  ServiceTypeId,
  ServiceTypeConfig
>([
  [
    "wedding-dj",
    {
      id: "wedding-dj",
      label: "DJ Mariage",
      budgetUnit: "total",
      defaultBudgetTarget: 1000,
      defaultBudgetMax: 1300,
    },
  ],
  [
    "kids-entertainer",
    {
      id: "kids-entertainer",
      label: "Animateur Enfant",
      budgetUnit: "total",
      defaultBudgetTarget: 500,
      defaultBudgetMax: 800,
    },
  ],
])

export const ALL_SERVICE_TYPE_IDS: readonly ServiceTypeId[] = [...SERVICE_TYPE_CONFIGS.keys()]

const SERVICE_TYPE_ID_SET: ReadonlySet<string> = new Set<string>(SERVICE_TYPE_CONFIGS.keys())

export const getServiceTypeConfig = (id: ServiceTypeId): ServiceTypeConfig => {
  const config = SERVICE_TYPE_CONFIGS.get(id)
  if (!config) {
    throw new Error(`Unknown service type: "${id}". Available: ${ALL_SERVICE_TYPE_IDS.join(", ")}`)
  }
  return config
}

export const isServiceTypeId = (value: string): value is ServiceTypeId =>
  SERVICE_TYPE_ID_SET.has(value)

// --- Prompt configs ---

const PROMPT_CONFIGS: ReadonlyMap<ServiceTypeId, PromptConfig> = new Map<
  ServiceTypeId,
  PromptConfig
>([["wedding-dj", weddingDjPromptConfig]])

export const getPromptConfig = (serviceTypeId: ServiceTypeId): PromptConfig => {
  const config = PROMPT_CONFIGS.get(serviceTypeId)
  if (!config) {
    throw new Error(
      `No prompt configuration found for service type "${serviceTypeId}". ` +
        `Available: ${[...PROMPT_CONFIGS.keys()].join(", ")}`,
    )
  }
  return config
}

export const hasPromptConfig = (serviceTypeId: ServiceTypeId): boolean =>
  PROMPT_CONFIGS.has(serviceTypeId)
