export interface PromptPriority {
  id: string
  label: string
  description: string
  idealCondition?: string
  penaltyCondition?: string
}

export interface PromptVerdictRules {
  yes: string
  maybe: string
  no: string
}

export interface PromptEventContext {
  eventType?: string
  location?: string
  guestCount?: number
}

export interface PromptConfig {
  /** Role line for the system prompt. */
  role: string
  /** Short task instruction. */
  task: string
  /** Criteria that trigger an immediate "no" verdict. */
  eliminationCriteria: string[]
  /** Ordered priorities (most important first). */
  priorities: PromptPriority[]
  /** How to map score to verdict. */
  verdictRules: PromptVerdictRules
  /** Generic rules the LLM must follow. */
  rules: string[]
  /** Event-specific context injected into the prompt. */
  eventContext?: PromptEventContext
}
