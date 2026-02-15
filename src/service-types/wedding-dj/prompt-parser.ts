import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import yaml from "js-yaml"
import { z } from "zod"
import type { PromptConfig } from "../prompt-types.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const criterionExampleSchema = z.object({
  score: z.number(),
  description: z.string(),
})

const promptCriterionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  examples: z.array(criterionExampleSchema).optional(),
})

const promptConfigSchema = z.object({
  role: z.string(),
  task: z.string(),
  criteria: z.array(promptCriterionSchema),
})

const yamlPath = join(__dirname, "prompt.yaml")
const yamlContent = readFileSync(yamlPath, "utf-8")
const rawConfig = yaml.load(yamlContent)

export const weddingDjPromptConfig: PromptConfig = promptConfigSchema.parse(rawConfig)
