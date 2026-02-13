import { readFile } from "node:fs/promises"

import OpenAI from "openai"
import { zodResponseFormat } from "openai/helpers/zod"

import type { NormalizedProfile } from "../schema/normalized.js"
import { extractProfilesFromResults } from "../schema/validate.js"
import { throwIfAborted } from "../utils/cancel.js"
import { sleep } from "../utils/sleep.js"
import { buildProfilePayload } from "./build-payload.js"
import { djEvaluationSchema, toReportRecord, type ReportRecord } from "./dj-evaluation.js"

export const DEFAULT_MODEL = "gpt-5.2"
export const DEFAULT_REASONING_EFFORT = "high"
export const DEFAULT_VERBOSITY = "low"
export const DEFAULT_TEMPERATURE = 0.2
export const DEFAULT_MAX_OUTPUT_TOKENS = 800

export interface EvalProgressEvent {
  index: number
  total: number
  profileName: string
  website: string
  profileUrl: string | null
  score: number | null
  verdict: "yes" | "maybe" | "no" | null
  reason: string | null
  error: string | null
  elapsedMs: number
}

export type OnEvalProgress = (event: EvalProgressEvent) => void

export interface EvaluationResult {
  profile: NormalizedProfile
  evaluation: ReportRecord | null
  error: string | null
  rawOutput: string | null
  requestId?: string | null
}

const profileTitle = (profile: NormalizedProfile): string =>
  profile.name || profile.slug || profile.url || `${profile.website}:${String(profile.id)}`

export const loadProfiles = async (path: string): Promise<NormalizedProfile[]> => {
  const content = await readFile(path, "utf-8")
  const parsed = JSON.parse(content) as unknown
  return extractProfilesFromResults(parsed)
}

export const evaluateProfiles = async (args: {
  profiles: NormalizedProfile[]
  model: string
  criteriaText: string
  budgetTarget: number
  budgetMax: number
  sleepMs: number
  dryRun: boolean
  onProgress?: OnEvalProgress
  apiKey: string | null
  signal?: AbortSignal
}): Promise<EvaluationResult[]> => {
  const total = args.profiles.length
  const results: EvaluationResult[] = []
  const client = args.dryRun || !args.apiKey ? null : new OpenAI({ apiKey: args.apiKey })

  for (let idx = 0; idx < args.profiles.length; idx += 1) {
    throwIfAborted(args.signal)
    const profile = args.profiles[idx]
    const startedAt = Date.now()
    const index = idx + 1

    const emit = (
      event: Omit<EvalProgressEvent, "index" | "total" | "profileName" | "website" | "profileUrl" | "elapsedMs">,
    ) => {
      args.onProgress?.({
        index,
        total,
        profileName: profileTitle(profile),
        website: profile.website,
        profileUrl: profile.url,
        score: event.score,
        verdict: event.verdict,
        reason: event.reason,
        error: event.error,
        elapsedMs: Date.now() - startedAt,
      })
    }

    if (args.dryRun || !client) {
      results.push({
        profile,
        evaluation: null,
        error: "dry-run (no API call)",
        rawOutput: null,
      })
      emit({ score: null, verdict: null, reason: "dry-run (no API call)", error: "dry-run" })
      continue
    }

    if (idx > 0 && args.sleepMs > 0) {
      await sleep(args.sleepMs, args.signal)
    }

    const payload = buildProfilePayload(profile, args.budgetTarget, args.budgetMax)
    try {
      const completion = await client.chat.completions.parse({
        model: args.model,
        messages: [
          { role: "system", content: args.criteriaText },
          { role: "user", content: JSON.stringify(payload, null, 2) },
        ],
        response_format: zodResponseFormat(djEvaluationSchema, "dj_evaluation"),
        temperature: DEFAULT_TEMPERATURE,
        max_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
      }, args.signal ? { signal: args.signal } : undefined)

      const message = completion.choices[0]?.message
      if (message?.parsed) {
        const evaluation = toReportRecord(message.parsed)
        results.push({
          profile,
          evaluation,
          error: null,
          rawOutput: message.content ?? null,
          requestId: completion.id ?? null,
        })
        emit({
          score: evaluation.score,
          verdict: evaluation.verdict,
          reason: evaluation.summary || null,
          error: null,
        })
      } else {
        const refusalText = message?.refusal ? `refusal: ${message.refusal}` : "refusal: no content"
        results.push({
          profile,
          evaluation: null,
          error: refusalText,
          rawOutput: null,
        })
        emit({ score: null, verdict: null, reason: refusalText, error: refusalText })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      results.push({
        profile,
        evaluation: null,
        error: `API error: ${message}`,
        rawOutput: null,
      })
      emit({ score: null, verdict: null, reason: `API error: ${message}`, error: `API error: ${message}` })
    }
  }

  return results
}
