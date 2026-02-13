import { z } from "zod"

export const scoreBreakdownItemSchema = z.object({
  name: z.string(),
  value: z.number().int().min(0).max(100),
  justification: z.string().default(""),
})

export const djEvaluationSchema = z.object({
  score: z.number().int().min(0).max(100),
  verdict: z.enum(["yes", "maybe", "no"]),
  summary: z.string().default(""),
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  missing_info: z.array(z.string()).default([]),
  questions: z.array(z.string()).default([]),
  score_breakdown: z.array(scoreBreakdownItemSchema).default([]),
})

export type DjEvaluation = z.infer<typeof djEvaluationSchema>

export interface ReportRecord {
  score: number
  verdict: "yes" | "maybe" | "no"
  summary: string
  pros: string[]
  cons: string[]
  risks: string[]
  missing_info: string[]
  questions: string[]
  score_breakdown: Record<string, number> | null
  score_justifications?: Record<string, string>
}

export const toReportRecord = (evaluation: DjEvaluation): ReportRecord => {
  const scoreBreakdown: Record<string, number> = {}
  const scoreJustifications: Record<string, string> = {}
  for (const item of evaluation.score_breakdown) {
    scoreBreakdown[item.name] = item.value
    if (item.justification) {
      scoreJustifications[item.name] = item.justification
    }
  }
  const report: ReportRecord = {
    score: evaluation.score,
    verdict: evaluation.verdict,
    summary: evaluation.summary,
    pros: evaluation.pros,
    cons: evaluation.cons,
    risks: evaluation.risks,
    missing_info: evaluation.missing_info,
    questions: evaluation.questions,
    score_breakdown: Object.keys(scoreBreakdown).length > 0 ? scoreBreakdown : null,
  }
  if (Object.keys(scoreJustifications).length > 0) {
    report.score_justifications = scoreJustifications
  }
  return report
}
