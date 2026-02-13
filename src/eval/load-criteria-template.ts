import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const DEFAULT_RELATIVE_PROMPT_PATH = "../../prompts/dj-evaluation-criteria.md"

export const loadCriteriaTemplate = async (): Promise<string> => {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const promptPath = join(moduleDir, DEFAULT_RELATIVE_PROMPT_PATH)
  return readFile(promptPath, "utf-8")
}
