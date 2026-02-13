import type { NormalizedProfile } from "../schema/normalized.js"
import { coerceFloat, coerceInt } from "../utils/coerce.js"
import type { EvaluationResult } from "./evaluate-profiles.js"

const sortKey = (item: EvaluationResult): [number, number] => {
  const score = item.evaluation?.score
  if (typeof score === "number") {
    return [0, -score]
  }
  return [1, -1]
}

const safeMd = (value: unknown): string => String(value ?? "").replaceAll("|", "\\|")

const profileTitle = (profile: NormalizedProfile): string =>
  profile.name || profile.slug || profile.url || `${profile.website}:${String(profile.id)}`

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
  reasoningEffort: string
  verbosity: string
  criteriaText: string
  maxProfiles?: number
}): string => {
  const lines: string[] = []
  let ordered = [...args.evals].sort((a, b) => {
    const aKey = sortKey(a)
    const bKey = sortKey(b)
    if (aKey[0] !== bKey[0]) return aKey[0] - bKey[0]
    return aKey[1] - bKey[1]
  })
  if (typeof args.maxProfiles === "number") {
    ordered = ordered.slice(0, Math.max(0, args.maxProfiles))
  }

  const byWebsite: Record<string, number> = {}
  for (const item of ordered) {
    const website = item.profile.website || "unknown"
    byWebsite[website] = (byWebsite[website] ?? 0) + 1
  }

  lines.push(`# DJ — Rapport d'évaluation (${args.model})`)
  lines.push("")
  lines.push(`- Généré: ${new Date().toISOString()}`)
  lines.push(`- Modèle: ${args.model}`)
  lines.push(`- Reasoning effort: ${args.reasoningEffort}`)
  lines.push(`- Verbosité: ${args.verbosity}`)
  lines.push(`- Profils analysés: ${ordered.length}`)
  if (Object.keys(byWebsite).length > 0) {
    const stats = Object.entries(byWebsite)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([site, count]) => `${site}: ${count}`)
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
  lines.push("| # | Profil | Site | Lieu | Prix min (€) | Note | Score | Verdict |")
  lines.push("|---:|---|---|---|---:|---:|---:|---|")

  ordered.forEach((item, idx) => {
    const profile = item.profile
    const evaluation = item.evaluation
    lines.push(
      `| ${idx + 1} | ${safeMd(profileTitle(profile))} | ${safeMd(profile.website)} | ${safeMd(profile.location.text ?? profile.location.city ?? "")} | ${formatMoney(coerceFloat(profile.pricing.min))} | ${safeMd(formatRating(coerceFloat(profile.ratings.value), coerceInt(profile.ratings.count)))} | ${evaluation?.score ?? ""} | ${safeMd(evaluation?.verdict ?? "")} |`,
    )
  })

  lines.push("")
  lines.push("## Détails par profil")

  ordered.forEach((item, idx) => {
    const profile = item.profile
    lines.push("")
    lines.push(`### ${idx + 1}. ${profileTitle(profile)} — ${profile.website}`)
    lines.push("")
    if (profile.url) lines.push(`- URL: ${profile.url}`)
    if (profile.slug) lines.push(`- Slug: ${profile.slug}`)
    if (profile.location.text || profile.location.city) {
      lines.push(`- Lieu: ${profile.location.text ?? profile.location.city ?? ""}`)
    }
    const priceMin = formatMoney(coerceFloat(profile.pricing.min))
    if (priceMin) lines.push(`- Prix min: ${priceMin} €`)
    const priceMax = formatMoney(coerceFloat(profile.pricing.max))
    if (priceMax) lines.push(`- Prix max: ${priceMax} €`)
    const rating = formatRating(coerceFloat(profile.ratings.value), coerceInt(profile.ratings.count))
    if (rating) lines.push(`- Note: ${rating}`)

    if (item.evaluation) {
      const evaluation = item.evaluation
      lines.push(`- Score: ${evaluation.score}/100`)
      lines.push(`- Verdict: ${evaluation.verdict}`)
      if (evaluation.summary) lines.push(`- Synthèse: ${evaluation.summary}`)
      if (evaluation.pros.length) lines.push(`- Points forts: ${evaluation.pros.join("; ")}`)
      if (evaluation.cons.length) lines.push(`- Points faibles: ${evaluation.cons.join("; ")}`)
      if (evaluation.risks.length) lines.push(`- Risques: ${evaluation.risks.join("; ")}`)
      if (evaluation.missing_info.length) lines.push(`- Infos manquantes: ${evaluation.missing_info.join("; ")}`)
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
  })

  lines.push("")
  lines.push("---")
  lines.push("Rapport généré automatiquement. Vérifiez les informations critiques avant décision.")
  lines.push("")
  return lines.join("\n")
}
