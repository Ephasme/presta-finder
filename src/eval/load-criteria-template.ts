import { getPromptConfig } from "../service-types/registry.js"
import { renderSystemPrompt } from "../service-types/prompt-render.js"
import type { ServiceTypeId } from "../service-types/types.js"

export const loadCriteriaText = (serviceTypeId: ServiceTypeId): string => {
  const config = getPromptConfig(serviceTypeId)
  return renderSystemPrompt(config)
}
