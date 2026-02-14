import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import yaml from "js-yaml"
import { z } from "zod"
import type { PromptConfig } from "../prompt-types.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const promptPrioritySchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  idealCondition: z.string().optional(),
  penaltyCondition: z.string().optional(),
  examples: z.array(z.string()).optional(),
})

const promptConfigSchema = z.object({
  role: z.string(),
  task: z.string(),
  eliminationCriteria: z.array(z.string()),
  priorities: z.array(promptPrioritySchema),
  verdictRules: z.object({
    yes: z.string(),
    maybe: z.string(),
    no: z.string(),
  }),
  rules: z.array(z.string()),
  eventContext: z
    .object({
      eventType: z.string().optional(),
      location: z.string().optional(),
      date: z.string().optional(),
      guestCount: z.number().optional(),
      musicalStylesDesired: z.array(z.string()).optional(),
      musicalStylesToAvoid: z.array(z.string()).optional(),
    })
    .optional(),
})

const yamlPath = join(__dirname, "prompt.yaml")
const yamlContent = readFileSync(yamlPath, "utf-8")
const rawConfig = yaml.load(yamlContent)

export const weddingDjPromptConfig: PromptConfig = promptConfigSchema.parse(rawConfig)
