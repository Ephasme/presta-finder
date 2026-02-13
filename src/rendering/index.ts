import { InteractiveRenderer } from "./interactive.js"
import { PlainRenderer } from "./plain.js"
import type { CliRenderer } from "./types.js"

export * from "./types.js"

export const createRenderer = (mode: "interactive" | "plain"): CliRenderer => {
  if (mode === "plain") {
    return new PlainRenderer()
  }
  return new InteractiveRenderer()
}
