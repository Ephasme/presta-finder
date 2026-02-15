import { PlainRenderer } from "./plain.js"
import type { CliRenderer } from "./types.js"

export * from "./types.js"

export const createRenderer = (): CliRenderer => {
  return new PlainRenderer()
}
