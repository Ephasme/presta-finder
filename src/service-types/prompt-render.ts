import type { PromptConfig } from "./prompt-types.js"

export const renderSystemPrompt = (config: PromptConfig): string => {
  const lines: string[] = []

  lines.push("## Rôle")
  lines.push("")
  lines.push(config.role)
  lines.push("")

  lines.push("## Tâche")
  lines.push("")
  lines.push(config.task)
  lines.push("")

  if (config.criteria.length > 0) {
    lines.push("## Critères d'évaluation")
    lines.push("")
    for (const [idx, criterion] of config.criteria.entries()) {
      lines.push(`${idx + 1}. **${criterion.label}** — ${criterion.description}`)
      if (criterion.examples?.length) {
        lines.push(`   Exemples calibrés :`)
        for (const example of criterion.examples) {
          lines.push(`   - **Note ${example.score}/100** — Profil type :`)
          for (const block of example.description.split("\n")) {
            lines.push(`     ${block}`)
          }
        }
      }
    }
    lines.push("")
  }

  return lines.join("\n")
}
