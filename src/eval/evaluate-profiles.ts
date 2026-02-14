import OpenAI from "openai"
import pLimit from "p-limit"
import type { ReasoningEffort } from "openai/resources/shared.js"
import { zodResponseFormat } from "openai/helpers/zod"

import type { AnyServiceProfile } from "../service-types/merged.js"
import { throwIfAborted } from "../utils/cancel.js"
import { buildProfilePayload } from "./build-payload.js"
import { evaluationSchema, toReportRecord, type ReportRecord } from "./evaluation.js"
import { profileTitle } from "./profile-title.js"

export const DEFAULT_MODEL = "gpt-5-nano"
export const DEFAULT_REASONING_EFFORT = "low"
export const DEFAULT_VERBOSITY = "low"
export const DEFAULT_TEMPERATURE = 0.2
export const DEFAULT_MAX_OUTPUT_TOKENS = 800

export interface EvalProgressEvent {
  index: number
  total: number
  worker: number
  workerTotal: number
  profileName: string
  provider: string
  profileUrl: string | null
  score: number | null
  verdict: "yes" | "maybe" | "no" | null
  reason: string | null
  error: string | null
  elapsedMs: number
}

export type OnEvalProgress = (event: EvalProgressEvent) => void

export interface EvaluationResult {
  profile: AnyServiceProfile
  evaluation: ReportRecord | null
  error: string | null
  rawOutput: string | null
  requestId?: string | null
}

export const DEFAULT_EVAL_CONCURRENCY = 4

export const evaluateProfiles = async (args: {
  profiles: AnyServiceProfile[]
  model: string
  reasoningEffort: ReasoningEffort
  criteriaText: string
  concurrency?: number
  dryRun: boolean
  onProgress?: OnEvalProgress
  apiKey: string | null
  signal?: AbortSignal
}): Promise<EvaluationResult[]> => {
  throwIfAborted(args.signal)
  const total = args.profiles.length
  const workerTotal = Math.max(1, args.concurrency ?? DEFAULT_EVAL_CONCURRENCY)
  const client = args.dryRun || !args.apiKey ? null : new OpenAI({ apiKey: args.apiKey })
  const limit = pLimit(workerTotal)
  const activeWorkers = new Set<number>()

  const acquireWorker = (): number => {
    for (let worker = 1; worker <= workerTotal; worker += 1) {
      if (!activeWorkers.has(worker)) {
        activeWorkers.add(worker)
        return worker
      }
    }
    return 1
  }

  const releaseWorker = (worker: number): void => {
    activeWorkers.delete(worker)
  }

  const tasks = args.profiles.map((profile, idx) => {
    const index = idx + 1
    return limit(async (): Promise<EvaluationResult> => {
      const worker = acquireWorker()
      throwIfAborted(args.signal)
      const startedAt = Date.now()
      const emit = (
        event: Omit<
          EvalProgressEvent,
          | "index"
          | "total"
          | "worker"
          | "workerTotal"
          | "profileName"
          | "provider"
          | "profileUrl"
          | "elapsedMs"
        >,
      ) => {
        args.onProgress?.({
          index,
          total,
          worker,
          workerTotal,
          profileName: profileTitle(profile),
          provider: profile.provider,
          profileUrl: profile.profileUrl,
          score: event.score,
          verdict: event.verdict,
          reason: event.reason,
          error: event.error,
          elapsedMs: Date.now() - startedAt,
        })
      }

      try {
        if (args.dryRun || !client) {
          const result: EvaluationResult = {
            profile,
            evaluation: null,
            error: "dry-run (no API call)",
            rawOutput: null,
          }
          emit({ score: null, verdict: null, reason: "dry-run (no API call)", error: "dry-run" })
          return result
        }

        const payload = buildProfilePayload(profile)
        try {
          const completion = await client.chat.completions.parse(
            {
              model: args.model,
              messages: [
                { role: "system", content: args.criteriaText },
                { role: "user", content: JSON.stringify(payload, null, 2) },
              ],
              response_format: zodResponseFormat(evaluationSchema, "profile_evaluation"),
              temperature: DEFAULT_TEMPERATURE,
              max_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
              reasoning_effort: args.reasoningEffort,
            },
            args.signal ? { signal: args.signal } : undefined,
          )

          const message = completion.choices[0]?.message
          if (message.parsed) {
            const evaluation = toReportRecord(message.parsed)
            emit({
              score: evaluation.score,
              verdict: evaluation.verdict,
              reason: evaluation.summary || null,
              error: null,
            })
            return {
              profile,
              evaluation,
              error: null,
              rawOutput: message.content ?? null,
              requestId: completion.id,
            }
          }
          const refusalText = message.refusal
            ? `refusal: ${message.refusal}`
            : "refusal: no content"
          emit({ score: null, verdict: null, reason: refusalText, error: refusalText })
          return {
            profile,
            evaluation: null,
            error: refusalText,
            rawOutput: null,
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          emit({
            score: null,
            verdict: null,
            reason: `API error: ${message}`,
            error: `API error: ${message}`,
          })
          return {
            profile,
            evaluation: null,
            error: `API error: ${message}`,
            rawOutput: null,
          }
        }
      } finally {
        releaseWorker(worker)
      }
    })
  })

  return Promise.all(tasks)
}
