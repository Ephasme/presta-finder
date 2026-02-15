import type {
  CliRenderer,
  DecisionLineEntry,
  FileEntry,
  ServiceStatus,
  WorkerProgressEvent,
} from "./types.js"

export class PlainRenderer implements CliRenderer {
  header(
    runId: string,
    outputDir: string,
    dryRun: boolean,
    model: string,
    reasoningEffort: string | null,
  ): void {
    console.log("=== DJ Profile Research Pipeline ===")
    console.log(`Run ID:  ${runId}`)
    console.log(`Output:  ${outputDir}`)
    console.log(`Mode:    ${dryRun ? "DRY RUN" : "LIVE"}`)
    console.log(`Model:   ${model}`)
    console.log(`Effort:  ${reasoningEffort ?? "default"}`)
    console.log("")
  }

  envTable(services: ServiceStatus[]): void {
    console.log("Service         Status")
    for (const service of services) {
      let status: string
      if (service.ready) {
        status = "ready"
      } else if (service.required) {
        status = "missing (required)"
      } else {
        status = "not configured"
      }
      console.log(`${service.name.padEnd(15)} ${status}`)
    }
    console.log("")
  }

  // --- Phase 1: Listing ---

  listingStarted(displayName: string): void {
    console.log(`[LISTING] ${displayName} - fetching...`)
  }

  listingComplete(displayName: string, taskCount: number, listingCount: number): void {
    console.log(`[LISTING] ${displayName} - ${taskCount} tasks from ${listingCount} listings`)
  }

  listingError(displayName: string, errorMessage: string): void {
    console.log(`[LISTING ERR] ${displayName} - ${errorMessage}`)
  }

  listingSkipped(displayName: string): void {
    console.log(`[LISTING SKIP] ${displayName}`)
  }

  // --- Phase 2: Worker pool ---

  updateWorkerProgress(event: WorkerProgressEvent): void {
    const prefix = `[${event.taskIndex}/${event.taskTotal}] [W${event.worker}]`
    switch (event.phase) {
      case "fetching":
        console.log(`${prefix} fetching ${event.provider}/${event.target}`)
        break
      case "evaluating":
        console.log(`${prefix} evaluating ${event.provider}/${event.target}`)
        break
      case "done": {
        const verdictStr = event.verdict ? ` ${event.verdict.toUpperCase()}` : ""
        const scoreStr = event.score !== undefined ? ` score=${event.score}` : ""
        console.log(`${prefix} done ${event.provider}/${event.target}${verdictStr}${scoreStr}`)
        break
      }
      case "error":
        console.log(`${prefix} error ${event.provider}/${event.target}`)
        break
    }
  }

  formatDecisionLine(entry: DecisionLineEntry): string {
    const verdict = entry.verdict.toUpperCase()
    const compactReason = entry.reason.trim().replaceAll(/\s+/g, " ")
    const reason = compactReason.length > 140 ? `${compactReason.slice(0, 137)}...` : compactReason
    return `${verdict} ${entry.profileName} — ${reason}`
  }

  logVerbose(provider: string, message: string, elapsedSec: number): void {
    console.log(`[+${elapsedSec.toFixed(2)}s] [${provider}] ${message}`)
  }

  pipelineComplete(elapsedSeconds: number, outputDir: string): void {
    console.log("")
    console.log("=== Pipeline Complete ===")
    console.log(`Duration: ${elapsedSeconds}s`)
    console.log(`Output:   ${outputDir}`)
  }

  showFiles(files: FileEntry[]): void {
    console.log("")
    console.log("Files:")
    for (const file of files) {
      console.log(`  ${file.name.padEnd(28)} ${file.sizeKb}`)
    }
  }

  warn(message: string): void {
    console.warn(message)
  }

  error(message: string): void {
    console.error(message)
  }
}
