import type { EvaluationResult } from "./evaluate-profiles.js"
import { profileTitle } from "./profile-title.js"

const sortKey = (item: EvaluationResult): [number, number] => {
  const score = item.evaluation?.score
  if (typeof score === "number") {
    return [0, -score]
  }
  return [1, -1]
}

const safeMd = (value: unknown): string => {
  const s = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value)
  return s.replaceAll("|", "\\|")
}

const formatMoney = (value: number | null): string => {
  if (value === null) {
    return ""
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

const formatRating = (value: number | null, count: number | null): string => {
  if (value === null && count === null) {
    return ""
  }
  if (value === null) {
    return count !== null ? `? (${count} avis)` : ""
  }
  if (count === null) {
    return value.toFixed(2)
  }
  return `${value.toFixed(2)} (${count} avis)`
}

export const renderReport = (args: {
  evals: EvaluationResult[]
  model: string
  reasoningEffort: string | null
  verbosity: string
  criteriaText: string
  serviceTypeLabel?: string
}): string => {
  const lines: string[] = []
  const ordered = [...args.evals].sort((a, b) => {
    const aKey = sortKey(a)
    const bKey = sortKey(b)
    if (aKey[0] !== bKey[0]) return aKey[0] - bKey[0]
    return aKey[1] - bKey[1]
  })

  const byProvider: Record<string, number> = {}
  for (const item of ordered) {
    const provider = item.profile.provider || "unknown"
    byProvider[provider] = (byProvider[provider] ?? 0) + 1
  }

  const title = args.serviceTypeLabel ?? "DJ"
  lines.push(`# ${title} — Rapport d'évaluation (${args.model})`)
  lines.push("")
  lines.push(`- Généré: ${new Date().toISOString()}`)
  lines.push(`- Modèle: ${args.model}`)
  lines.push(`- Reasoning effort: ${args.reasoningEffort ?? "default"}`)
  lines.push(`- Verbosité: ${args.verbosity}`)
  lines.push(`- Profils analysés: ${ordered.length}`)
  if (Object.keys(byProvider).length > 0) {
    const stats = Object.entries(byProvider)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([provider, count]) => `${provider}: ${count}`)
      .join(", ")
    lines.push(`- Répartition: ${stats}`)
  }
  lines.push("")
  lines.push("## Critères utilisés")
  lines.push("")
  for (const rawLine of args.criteriaText.trim().split("\n")) {
    lines.push(rawLine.trim() ? `> ${rawLine}` : "")
  }
  lines.push("")
  lines.push("## Résumé")
  lines.push("")
  lines.push("| # | Profil | Provider | Lieu | Prix min (€) | Note | Score | Verdict |")
  lines.push("|---:|---|---|---|---:|---:|---:|---|")

  for (const [idx, item] of ordered.entries()) {
    const profile = item.profile
    const evaluation = item.evaluation
    lines.push(
      `| ${idx + 1} | ${safeMd(profileTitle(profile))} | ${safeMd(profile.provider)} | ${safeMd(profile.location.city ?? profile.location.region ?? "")} | ${formatMoney(profile.budgetSummary.minKnownPrice)} | ${safeMd(formatRating(profile.reputation.rating, profile.reputation.reviewCount))} | ${evaluation?.score ?? ""} | ${safeMd(evaluation?.verdict ?? "")} |`,
    )
  }

  lines.push("")
  lines.push("## Détails par profil")

  for (const [idx, item] of ordered.entries()) {
    const profile = item.profile
    lines.push("")
    lines.push(`### ${idx + 1}. ${profileTitle(profile)} — ${profile.provider}`)
    lines.push("")
    if (profile.profileUrl) lines.push(`- URL: ${profile.profileUrl}`)
    if (profile.providerId) lines.push(`- ID: ${profile.providerId}`)
    if (profile.location.city || profile.location.region) {
      const location = [profile.location.city, profile.location.region]
        .filter((v): v is string => Boolean(v))
        .join(", ")
      if (location) lines.push(`- Lieu: ${location}`)
    }
    const priceMin = formatMoney(profile.budgetSummary.minKnownPrice)
    if (priceMin) lines.push(`- Prix min: ${priceMin} €`)
    const priceMax = formatMoney(profile.budgetSummary.maxKnownPrice)
    if (priceMax) lines.push(`- Prix max: ${priceMax} €`)
    const rating = formatRating(profile.reputation.rating, profile.reputation.reviewCount)
    if (rating) lines.push(`- Note: ${rating}`)

    if (item.evaluation) {
      const evaluation = item.evaluation
      lines.push(`- Score: ${evaluation.score}/100`)
      lines.push(`- Verdict: ${evaluation.verdict}`)
      if (evaluation.summary) lines.push(`- Synthèse: ${evaluation.summary}`)
      if (evaluation.pros.length) lines.push(`- Points forts: ${evaluation.pros.join("; ")}`)
      if (evaluation.cons.length) lines.push(`- Points faibles: ${evaluation.cons.join("; ")}`)
      if (evaluation.risks.length) lines.push(`- Risques: ${evaluation.risks.join("; ")}`)
      if (evaluation.missing_info.length)
        lines.push(`- Infos manquantes: ${evaluation.missing_info.join("; ")}`)
      if (evaluation.questions.length) lines.push(`- Questions: ${evaluation.questions.join("; ")}`)
      if (evaluation.score_breakdown) {
        const detail = Object.entries(evaluation.score_breakdown)
          .map(([name, value]) => `${name}=${value}`)
          .join(", ")
        lines.push(`- Détail score: ${detail}`)
      }
      if (evaluation.score_justifications) {
        const detail = Object.entries(evaluation.score_justifications)
          .map(([name, text]) => `${name}: ${text}`)
          .join(" | ")
        lines.push(`- Justifications: ${detail}`)
      }
    } else {
      lines.push(`- Erreur: ${item.error}`)
    }
  }

  lines.push("")
  lines.push("---")
  lines.push("Rapport généré automatiquement. Vérifiez les informations critiques avant décision.")
  lines.push("")
  return lines.join("\n")
}
