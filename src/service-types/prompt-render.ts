import type { PromptConfig } from "./prompt-types.js"

export interface RenderContext {
  budgetTarget: number
  budgetMax: number
  /** Override the event location from prompt config. */
  locationOverride?: string
}

const applyTemplateVars = (text: string, ctx: RenderContext): string =>
  text
    .replaceAll("{budget_target}", String(ctx.budgetTarget))
    .replaceAll("{budget_max}", String(ctx.budgetMax))

export const renderSystemPrompt = (config: PromptConfig, ctx: RenderContext): string => {
  const lines: string[] = []

  lines.push("## Rôle")
  lines.push("")
  lines.push(config.role)
  lines.push("")

  lines.push("## Tâche")
  lines.push("")
  lines.push(config.task)
  lines.push("")

  lines.push("## Contraintes")
  lines.push("")

  if (config.eliminationCriteria.length > 0) {
    lines.push("### Critère éliminatoire (→ verdict no immédiat)")
    lines.push("")
    for (const criterion of config.eliminationCriteria) {
      lines.push(`- ${applyTemplateVars(criterion, ctx)}`)
    }
    lines.push("")
  }

  lines.push("### Priorités (par ordre d'importance)")
  lines.push("")
  for (const [idx, priority] of config.priorities.entries()) {
    lines.push(
      `${idx + 1}. **${priority.label}** — ${applyTemplateVars(priority.description, ctx)}`,
    )
  }
  lines.push("")

  lines.push("### Verdict")
  lines.push("")
  lines.push(`- **yes** — ${applyTemplateVars(config.verdictRules.yes, ctx)}`)
  lines.push(`- **maybe** — ${applyTemplateVars(config.verdictRules.maybe, ctx)}`)
  lines.push(`- **no** — ${applyTemplateVars(config.verdictRules.no, ctx)}`)
  lines.push("")

  if (config.rules.length > 0) {
    lines.push("### Règles")
    lines.push("")
    for (const rule of config.rules) {
      lines.push(`- ${applyTemplateVars(rule, ctx)}`)
    }
    lines.push("")
  }

  if (config.eventContext) {
    lines.push("## Contexte")
    lines.push("")
    if (config.eventContext.eventType) {
      const guestInfo = config.eventContext.guestCount
        ? `, ~${config.eventContext.guestCount} invités`
        : ""
      lines.push(`Événement : ${config.eventContext.eventType}${guestInfo}.`)
    }
    const location = ctx.locationOverride ?? config.eventContext.location
    if (location) {
      lines.push(`Lieu : ${location}.`)
    }
    lines.push(`Budget cible : ${ctx.budgetTarget}€ (strict). Budget max : ${ctx.budgetMax}€.`)
    lines.push("")
  }

  return lines.join("\n")
}
