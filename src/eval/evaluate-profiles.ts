import OpenAI from "openai"
import type { ReasoningEffort } from "openai/resources/shared.js"
import { zodResponseFormat } from "openai/helpers/zod"

import type { AnyServiceProfile } from "../service-types/merged.js"
import { throwIfAborted } from "../utils/cancel.js"
import { buildProfilePayload } from "./build-payload.js"
import { evaluationSchema, toReportRecord, type ReportRecord } from "./evaluation.js"

export const DEFAULT_MODEL = "gpt-5-nano"
export const DEFAULT_REASONING_EFFORT = "low"
export const DEFAULT_VERBOSITY = "low"
export const DEFAULT_TEMPERATURE = 0.2
export const DEFAULT_MAX_OUTPUT_TOKENS = 800

export interface EvaluationResult {
  profile: AnyServiceProfile
  evaluation: ReportRecord | null
  error: string | null
  rawOutput: string | null
  requestId?: string | null
}

/**
 * Evaluate a single profile using the OpenAI API.
 * This function is designed to be called from a worker pool.
 */
export const evaluateOneProfile = async (args: {
  profile: AnyServiceProfile
  client: OpenAI | null
  model: string
  reasoningEffort: ReasoningEffort
  criteriaText: string
  dryRun: boolean
  signal?: AbortSignal
}): Promise<EvaluationResult> => {
  throwIfAborted(args.signal)

  if (args.dryRun || !args.client) {
    return {
      profile: args.profile,
      evaluation: null,
      error: "dry-run (no API call)",
      rawOutput: null,
    }
  }

  const payload = buildProfilePayload(args.profile)
  try {
    const completion = await args.client.chat.completions.parse(
      {
        model: args.model,
        messages: [
          { role: "system", content: args.criteriaText },
          { role: "user", content: JSON.stringify(payload, null, 2) },
        ],
        response_format: zodResponseFormat(evaluationSchema, "profile_evaluation"),
        reasoning_effort: args.reasoningEffort,
      },
      args.signal ? { signal: args.signal } : undefined,
    )

    const message = completion.choices[0]?.message
    if (message.parsed) {
      const evaluation = toReportRecord(message.parsed)
      return {
        profile: args.profile,
        evaluation,
        error: null,
        rawOutput: message.content ?? null,
        requestId: completion.id,
      }
    }
    const refusalText = message.refusal
      ? `refusal: ${message.refusal}`
      : "refusal: no content"
    return {
      profile: args.profile,
      evaluation: null,
      error: refusalText,
      rawOutput: null,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return {
      profile: args.profile,
      evaluation: null,
      error: `API error: ${errorMessage}`,
      rawOutput: null,
    }
  }
}
