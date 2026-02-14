import { getPromptConfig } from "../service-types/registry.js"
import { renderSystemPrompt, type RenderContext } from "../service-types/prompt-render.js"
import type { ServiceTypeId } from "../service-types/types.js"

export const loadCriteriaText = (serviceTypeId: ServiceTypeId, ctx: RenderContext): string => {
  const config = getPromptConfig(serviceTypeId)
  return renderSystemPrompt(config, ctx)
}
