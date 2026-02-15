export interface CriterionExample {
  score: number
  description: string
}

export interface PromptCriterion {
  id: string
  label: string
  description: string
  examples?: CriterionExample[]
}

export interface PromptConfig {
  /** Role line for the system prompt. */
  role: string
  /** Short task instruction. */
  task: string
  /** Evaluation criteria for the LLM. */
  criteria: PromptCriterion[]
}
