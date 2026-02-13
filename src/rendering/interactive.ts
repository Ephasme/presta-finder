import boxen from "boxen"
import chalk from "chalk"
import cliProgress from "cli-progress"
import Table from "cli-table3"
import ora from "ora"

import type {
  CliRenderer,
  DecisionLineEntry,
  FileEntry,
  ProgressTracker,
  ServiceStatus,
  SpinnerHandle,
} from "./types.js"

export class InteractiveRenderer implements CliRenderer {
  private multiBar: cliProgress.MultiBar | null = null

  header(runId: string, outputDir: string, dryRun: boolean): void {
    const body = [
      `${chalk.bold("Run ID")}    ${runId}`,
      `${chalk.bold("Output")}    ${outputDir}`,
      `${chalk.bold("Mode")}      ${dryRun ? chalk.yellow("DRY RUN") : chalk.green("LIVE")}`,
    ].join("\n")

    console.log(
      boxen(body, {
        title: chalk.bold("DJ Profile Research Pipeline"),
        borderColor: "blue",
        padding: 1,
      }),
    )
  }

  envTable(services: ServiceStatus[]): void {
    const table = new Table({
      head: [chalk.bold("Service"), chalk.bold("Status")],
    })

    for (const service of services) {
      const status = service.ready
        ? chalk.green("ready")
        : service.required
          ? chalk.red("missing (required)")
          : chalk.gray("not configured")
      table.push([service.name, status])
    }

    console.log(table.toString())
  }

  fetchStarted(displayName: string): void {
    console.log(chalk.cyan(`Fetching ${displayName}`))
  }

  createProgressTracker(providerName: string): ProgressTracker {
    const multi = this.getOrCreateMultiBar()
    const bar = multi.create(1, 0, { provider: providerName, status: "starting", phase: "listing" })
    let lastTotal = 1
    let lastCurrent = 0
    let currentPhase = "listing"

    return {
      onProgress(current, total, status) {
        const phase = status === undefined || status === "fetching" ? "fetching" : "listing"
        currentPhase = phase
        if (total > 0 && total !== lastTotal) {
          bar.setTotal(total)
          lastTotal = total
        }
        lastCurrent = current
        bar.update(current, { provider: providerName, status: status ?? "fetching", phase })
      },
      setStatus(status) {
        bar.update(lastCurrent, { provider: providerName, status, phase: currentPhase })
      },
    }
  }

  stopProgress(): void {
    this.multiBar?.stop()
    this.multiBar = null
  }

  providerSuccess(displayName: string, profileCount: number): void {
    console.log(chalk.green(`[OK] ${displayName} - ${profileCount} profiles`))
  }

  providerSkipped(displayName: string): void {
    console.log(chalk.yellow(`[WARN] ${displayName} - skipped`))
  }

  providerError(displayName: string, errorMessage: string): void {
    console.log(chalk.red(`[ERR] ${displayName} - ${errorMessage}`))
  }

  providerCancelled(displayName: string): void {
    console.log(chalk.yellow(`[CANCELLED] ${displayName}`))
  }

  createSpinner(text: string): SpinnerHandle {
    const spinner = ora(text).start()
    return {
      update(nextText) {
        spinner.text = nextText
      },
      succeed(finalText) {
        spinner.succeed(finalText)
      },
      fail(finalText) {
        spinner.fail(finalText)
      },
      warn(finalText) {
        spinner.warn(finalText)
      },
    }
  }

  formatDecisionLine(entry: DecisionLineEntry): string {
    const verdictLabel =
      entry.verdict === "yes"
        ? chalk.green("YES")
        : entry.verdict === "maybe"
          ? chalk.yellow("MAYBE")
          : entry.verdict === "no"
            ? chalk.red("NO")
            : entry.verdict === "error"
              ? chalk.red("ERROR")
              : chalk.gray("UNKNOWN")

    const compactReason = entry.reason.trim().replaceAll(/\s+/g, " ")
    const reason = compactReason.length > 140 ? `${compactReason.slice(0, 137)}...` : compactReason
    return `${chalk.dim("Last decision:")} ${verdictLabel} ${entry.profileName} — ${reason}`
  }

  logVerbose(provider: string, message: string, elapsedSec: number): void {
    console.log(chalk.gray(`[+${elapsedSec.toFixed(2)}s] [${provider}] ${message}`))
  }

  pipelineComplete(elapsedSeconds: number, outputDir: string): void {
    console.log(
      boxen(`${chalk.bold("Duration")}    ${elapsedSeconds}s\n${chalk.bold("Output")}      ${outputDir}`, {
        title: chalk.green("Pipeline Complete"),
        borderColor: "green",
        padding: 1,
      }),
    )
  }

  showFiles(files: FileEntry[]): void {
    const table = new Table({
      head: [chalk.bold("File"), chalk.bold("Size")],
    })

    for (const file of files) {
      table.push([file.isReport ? chalk.green(file.name) : file.name, file.sizeKb])
    }

    console.log(table.toString())
  }

  warn(message: string): void {
    console.warn(chalk.yellow(message))
  }

  error(message: string): void {
    console.error(chalk.red(message))
  }

  private getOrCreateMultiBar(): cliProgress.MultiBar {
    if (!this.multiBar) {
      this.multiBar = new cliProgress.MultiBar(
        {
          clearOnComplete: false,
          hideCursor: true,
          emptyOnZero: true,
          format: (options, params, payload) => {
            const provider = String(payload.provider ?? "")
            const status = String(payload.status ?? "")
            const phase = String(payload.phase ?? "listing")

            if (phase !== "fetching") {
              // Listing / starting phase — no bar, just status text
              return `  ${chalk.cyan("→")} ${provider} | ${chalk.dim(status)}`
            }

            // Fetching phase — show progress bar
            const barSize = options.barsize ?? 20
            const completeSize = Math.round(params.progress * barSize)
            const bar =
              (options.barCompleteString ?? "").substring(0, completeSize) +
              (options.barIncompleteString ?? "").substring(0, barSize - completeSize)
            return `  ${bar} ${params.value}/${params.total} | ${provider} | ${status}`
          },
        },
        cliProgress.Presets.shades_classic,
      )
    }

    return this.multiBar
  }
}
