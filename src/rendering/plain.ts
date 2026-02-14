import type {
  CliRenderer,
  DecisionLineEntry,
  FileEntry,
  ProgressTracker,
  ProviderResultSummary,
  ServiceStatus,
  SpinnerHandle,
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

  fetchStarted(displayName: string): void {
    console.log(`Fetching ${displayName}`)
  }

  createProgressTracker(providerName: string): ProgressTracker {
    let current = 0
    let total = 0
    let status = "starting"
    let phase: "listing" | "fetching" = "listing"
    let lastBucket = -1
    let lastLine = ""

    const logLine = (force: boolean): void => {
      let line: string
      if (phase === "listing") {
        // Listing phase — show status only, no bar numbers
        line = `[${providerName}] ${status}`
        if (line === lastLine && !force) {
          return
        }
      } else {
        // Fetching phase — show progress numbers
        const safeTotal = total > 0 ? total : 1
        const ratio = total > 0 ? current / total : 0
        const bucket = Math.floor(ratio * 10)
        const shouldLog =
          force || current === 0 || (total > 0 && current >= total) || bucket !== lastBucket

        if (!shouldLog) {
          return
        }

        lastBucket = bucket
        line = `[${providerName}] ${current}/${safeTotal} ${status}`
        if (line === lastLine) {
          return
        }
      }

      console.log(line)
      lastLine = line
    }

    return {
      onProgress(nextCurrent, nextTotal, nextStatus) {
        current = nextCurrent
        phase = nextStatus === undefined || nextStatus === "fetching" ? "fetching" : "listing"
        status = nextStatus ?? "fetching"
        if (nextTotal > 0) {
          total = nextTotal
        }
        logLine(false)
      },
      setStatus(nextStatus) {
        status = nextStatus
        logLine(true)
      },
    }
  }

  stopProgress(): void {
    // no-op
  }

  providerSuccess(displayName: string, summary: ProviderResultSummary): void {
    const listed = summary.listingCount ?? summary.profileCount
    if (
      summary.fetchLimit !== undefined &&
      summary.fetchedCount !== undefined &&
      listed > summary.fetchedCount
    ) {
      console.log(
        `[OK] ${displayName} - ${listed} listed, ${summary.fetchedCount} fetched (limit=${summary.fetchLimit})`,
      )
      return
    }
    console.log(`[OK] ${displayName} - ${summary.profileCount} profiles`)
  }

  providerSkipped(displayName: string): void {
    console.log(`[WARN] ${displayName} - skipped`)
  }

  providerError(displayName: string, errorMessage: string): void {
    console.log(`[ERR] ${displayName} - ${errorMessage}`)
  }

  providerCancelled(displayName: string): void {
    console.log(`[CANCELLED] ${displayName}`)
  }

  createSpinner(text: string): SpinnerHandle {
    console.log(`Starting: ${text}`)
    let lastText = text
    return {
      update(nextText) {
        if (nextText !== lastText) {
          console.log(nextText)
          lastText = nextText
        }
      },
      succeed(finalText) {
        console.log(`Done: ${finalText}`)
      },
      fail(finalText) {
        console.log(`Failed: ${finalText}`)
      },
      warn(finalText) {
        console.log(`Warning: ${finalText}`)
      },
    }
  }

  formatDecisionLine(entry: DecisionLineEntry): string {
    const verdict = entry.verdict.toUpperCase()
    const compactReason = entry.reason.trim().replaceAll(/\s+/g, " ")
    const reason = compactReason.length > 140 ? `${compactReason.slice(0, 137)}...` : compactReason
    return `Last decision: ${verdict} ${entry.profileName} — ${reason}`
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
