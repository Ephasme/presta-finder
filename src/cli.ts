import { mkdir, readdir, stat, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"

import { Command } from "commander"

import { readEnvConfig } from "./config.js"
import { evaluateProfiles, loadProfiles, type EvalProgressEvent } from "./eval/evaluate-profiles.js"
import { loadCriteriaTemplate } from "./eval/load-criteria-template.js"
import { renderReport } from "./eval/render-report.js"
import { mergeProfiles, writeMergedOutput } from "./merge/merge-profiles.js"
import { ALL_PROVIDERS, isProviderName, type ProviderName } from "./providers/registry.js"
import type { CliContext, Provider, VerboseLog } from "./providers/types.js"
import { createRenderer } from "./rendering/index.js"
import type { CliRenderer, FileEntry, ServiceStatus } from "./rendering/types.js"
import { isCancellationError, throwIfAborted } from "./utils/cancel.js"

type ProviderArg = ProviderName | "all"

interface CliOptions {
  outputDir: string
  runId?: string
  collectOnly: boolean
  dryRun: boolean
  plain: boolean
  verbose: boolean
  profileConcurrency: boolean
  providers: ProviderArg[]
  linkabandLat: number
  linkabandLng: number
  linkabandDateFrom: string
  linkabandDateTo: string
  livetonightCategories: string[]
  fetchLimit?: number
  budgetTarget: number
  budgetMax: number
  model: string
  reasoningEffort: string
  maxProfiles?: number
}

interface DecisionLogEntry {
  timestamp: string
  index: number
  total: number
  profileName: string
  website: string
  link: string | null
  verdict: "yes" | "maybe" | "no" | "error" | "unknown"
  reason: string
}

const nowRunId = (): string => {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, "0")
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

const parseProviderArgs = (values: unknown): ProviderArg[] => {
  if (!Array.isArray(values)) {
    return ["all"]
  }
  const parsed: ProviderArg[] = []
  for (const value of values) {
    const str = String(value)
    if (str === "all" || isProviderName(str)) {
      parsed.push(str)
    } else {
      const available = ALL_PROVIDERS.map((p) => p.name).join(" ")
      throw new Error(`Invalid provider "${str}". Use one of: all ${available}`)
    }
  }
  return parsed.length === 0 ? ["all"] : parsed
}

const resolveProviders = (requested: ProviderArg[]): Provider[] => {
  if (requested.some((arg) => arg === "all")) {
    return [...ALL_PROVIDERS]
  }
  const names = new Set(requested)
  return ALL_PROVIDERS.filter((p) => names.has(p.name))
}

const createProgram = (): Command => {
  const program = new Command()
  program
    .name("presta-finder")
    .description("DJ profile research pipeline")
    .option("--output-dir <path>", "Output directory", "output")
    .option("--run-id <id>", "Run id")
    .option("--collect-only", "Fetch + merge only, skip evaluation", false)
    .option("--dry-run", "No network calls", false)
    .option("--plain", "Use plain non-interactive output", false)
    .option("--verbose", "Show detailed timing logs", false)
    .option("--no-profile-concurrency", "Disable profile page concurrent fetching")
    .option(
      "--providers <providers...>",
      "Providers to run: 1001dj linkaband livetonight mariagesnet all",
      ["all"],
    )
    .option("--linkaband-lat <number>", "Linkaband latitude", "48.98")
    .option("--linkaband-lng <number>", "Linkaband longitude", "1.98")
    .option("--linkaband-date-from <date>", "Linkaband date from", "01-06-2025")
    .option("--linkaband-date-to <date>", "Linkaband date to", "30-09-2025")
    .option("--livetonight-categories <categories...>", "LiveTonight categories", ["DJ"])
    .option("--fetch-limit <number>", "Max profiles to fetch per provider")
    .option("--budget-target <number>", "Target budget", "1000")
    .option("--budget-max <number>", "Max budget", "1300")
    .option("--model <name>", "OpenAI model", "gpt-4o")
    .option("--reasoning-effort <level>", "Reasoning effort", "high")
    .option("--max-profiles <number>", "Max profiles to evaluate")
  return program
}

const parseOptions = (program: Command): CliOptions => {
  const opts = program.opts()
  return {
    outputDir: String(opts.outputDir),
    runId: opts.runId ? String(opts.runId) : undefined,
    collectOnly: Boolean(opts.collectOnly),
    dryRun: Boolean(opts.dryRun),
    plain: Boolean(opts.plain),
    verbose: Boolean(opts.verbose),
    profileConcurrency: Boolean(opts.profileConcurrency),
    providers: parseProviderArgs(opts.providers),
    linkabandLat: Number(opts.linkabandLat),
    linkabandLng: Number(opts.linkabandLng),
    linkabandDateFrom: String(opts.linkabandDateFrom),
    linkabandDateTo: String(opts.linkabandDateTo),
    livetonightCategories: Array.isArray(opts.livetonightCategories)
      ? opts.livetonightCategories.map((value: unknown) => String(value))
      : ["DJ"],
    fetchLimit: opts.fetchLimit !== undefined ? Number(opts.fetchLimit) : undefined,
    budgetTarget: Number(opts.budgetTarget),
    budgetMax: Number(opts.budgetMax),
    model: String(opts.model),
    reasoningEffort: String(opts.reasoningEffort),
    maxProfiles: opts.maxProfiles !== undefined ? Number(opts.maxProfiles) : undefined,
  }
}

const buildServiceStatusEntries = (): ServiceStatus[] => {
  const env = readEnvConfig()
  return [
    { name: "OpenAI API", ready: Boolean(env.openaiApiKey), required: true },
    { name: "Linkaband", ready: Boolean(env.linkabandApiKey) },
    { name: "Bright Data", ready: Boolean(env.brightdataApiKey && env.brightdataZone) },
  ]
}

const listGeneratedFiles = async (outputDir: string): Promise<FileEntry[]> => {
  const files = await readdir(outputDir)
  const entries: FileEntry[] = []

  for (const file of files.sort()) {
    if (!file.endsWith(".json") && !file.endsWith(".md")) {
      continue
    }
    const fullPath = join(outputDir, file)
    const fileStat = await stat(fullPath)
    const sizeKb = `${(fileStat.size / 1024).toFixed(1)} KB`
    entries.push({
      name: file,
      sizeKb,
      isReport: file.endsWith(".md"),
    })
  }
  return entries
}

const setupSigintCancellation = (renderer: CliRenderer): { signal: AbortSignal; dispose: () => void } => {
  const controller = new AbortController()
  let sigintCount = 0
  const onSigint = () => {
    sigintCount += 1
    if (sigintCount === 1) {
      renderer.warn("\nInterrupted (CTRL+C). Stopping current operation...")
      controller.abort(new Error("Interrupted by user (SIGINT)"))
      return
    }
    renderer.error("Force exit requested.")
    process.exit(130)
  }
  process.on("SIGINT", onSigint)
  return {
    signal: controller.signal,
    dispose: () => process.off("SIGINT", onSigint),
  }
}

interface ProviderRunResult {
  displayName: string
  outputFile: string
  success: boolean
  profileCount: number
}

interface ProviderRunError {
  displayName: string
  error: unknown
}

const main = async (): Promise<number> => {
  const startedAt = Date.now()
  const program = createProgram()
  const rawArgs = process.argv.slice(2)
  const normalizedArgs = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs
  program.parse(["node", "presta-finder", ...normalizedArgs])
  const options = parseOptions(program)
  const renderer = createRenderer(options.plain ? "plain" : "interactive")
  const { signal, dispose } = setupSigintCancellation(renderer)
  const isRunCancellation = (error: unknown): boolean => signal.aborted && isCancellationError(error)

  try {
    const runId = options.runId ?? nowRunId()
    const outputDir = join(options.outputDir, runId)
    await mkdir(outputDir, { recursive: true })

    renderer.header(runId, outputDir, options.dryRun)
    renderer.envTable(buildServiceStatusEntries())

    const providers = resolveProviders(options.providers)
    const context: CliContext = {
      linkabandLat: options.linkabandLat,
      linkabandLng: options.linkabandLng,
      linkabandDateFrom: options.linkabandDateFrom,
      linkabandDateTo: options.linkabandDateTo,
      livetonightCategories: options.livetonightCategories,
    }

    const t0 = Date.now()
    const verboseLog: VerboseLog | undefined = options.verbose
      ? (provider, message) => {
          const elapsed = (Date.now() - t0) / 1000
          renderer.logVerbose(provider, message, elapsed)
        }
      : undefined

    const tasks: Array<Promise<ProviderRunResult>> = []

    for (const provider of providers) {
      const outputFile = join(outputDir, provider.outputFile)
      renderer.fetchStarted(provider.displayName)
      const progress = renderer.createProgressTracker(provider.name)

      tasks.push(
        (async (): Promise<ProviderRunResult> => {
          try {
            verboseLog?.(provider.name, "task started")
            const result = await provider.fetch(
              {
                outputFile,
                dryRun: options.dryRun,
                profileConcurrency: options.profileConcurrency,
                fetchLimit: options.fetchLimit,
                onFetchProgress: progress.onProgress,
                verbose: verboseLog,
                signal,
              },
              context,
            )
            verboseLog?.(
              provider.name,
              `task finished (success=${result.success}, profiles=${result.profileCount})`,
            )
            progress.setStatus(result.success ? "done" : "skipped")
            return {
              displayName: provider.displayName,
              outputFile,
              success: result.success,
              profileCount: result.profileCount,
            }
          } catch (error) {
            verboseLog?.(provider.name, `task errored: ${getErrorMessage(error)}`)
            progress.setStatus(isRunCancellation(error) ? "cancelled" : "error")
            throw { displayName: provider.displayName, error } satisfies ProviderRunError
          }
        })(),
      )
    }
    verboseLog?.("cli", `scheduled ${tasks.length} provider tasks (running with Promise.allSettled)`)

    const settled = await Promise.allSettled(tasks)
    verboseLog?.("cli", "all provider tasks settled")
    renderer.stopProgress()

    const profileFiles: string[] = []
    for (const item of settled) {
      if (item.status === "fulfilled") {
        const run = item.value
        if (run.success) {
          profileFiles.push(run.outputFile)
          renderer.providerSuccess(run.displayName, run.profileCount)
        } else {
          renderer.providerSkipped(run.displayName)
        }
        continue
      }

      const reason = item.reason as ProviderRunError
      if (isRunCancellation(reason.error)) {
        renderer.providerCancelled(reason.displayName)
        throw reason.error
      }
      renderer.providerError(reason.displayName, getErrorMessage(reason.error))
    }

    throwIfAborted(signal)
    if (profileFiles.length === 0) {
      renderer.error("No provider output available")
      return 1
    }

    const mergeSpinner = renderer.createSpinner("Merging profiles")
    let mergedFile = ""
    try {
      const mergedProfiles = await mergeProfiles(profileFiles)
      throwIfAborted(signal)
      mergedFile = join(outputDir, "merged_profiles.json")
      await writeMergedOutput(mergedFile, mergedProfiles)
      mergeSpinner.succeed(`Merged ${mergedProfiles.length} unique profiles`)
    } catch (error) {
      if (isRunCancellation(error)) {
        mergeSpinner.warn("Merging profiles — cancelled")
        throw error
      }
      mergeSpinner.fail(`Merging profiles — ${getErrorMessage(error)}`)
      throw error
    }

    if (!options.collectOnly) {
      const evalSpinner = renderer.createSpinner("Evaluating 0/0 — 0Y 0M 0N 0E")
      const decisionLogFile = join(outputDir, "decision_log.jsonl")
      const env = readEnvConfig()
      if (!env.openaiApiKey && !options.dryRun) {
        evalSpinner.fail("Cannot evaluate: OPENAI_API_KEY not configured")
        return 1
      }

      const profiles = await loadProfiles(mergedFile)

      const tally = { yes: 0, maybe: 0, no: 0, error: 0 }
      let latestDecisionLine: string | null = null
      const decisionLogEntries: DecisionLogEntry[] = []

      const criteriaTemplate = await loadCriteriaTemplate()
      const criteriaText = criteriaTemplate
        .replaceAll("{budget_target}", String(options.budgetTarget))
        .replaceAll("{budget_max}", String(options.budgetMax))

      const onProgress = (event: EvalProgressEvent): void => {
        if (event.error) {
          tally.error += 1
        } else if (event.verdict) {
          tally[event.verdict] += 1
        }

        const verdictForLog: DecisionLogEntry["verdict"] = event.error
          ? "error"
          : event.verdict ?? "unknown"
        const reasonForLog = (event.reason ?? event.error ?? "No reasoning provided").trim()
        const logEntry: DecisionLogEntry = {
          timestamp: new Date().toISOString(),
          index: event.index,
          total: event.total,
          profileName: event.profileName,
          website: event.website,
          link: event.profileUrl ?? null,
          verdict: verdictForLog,
          reason: reasonForLog,
        }

        decisionLogEntries.push(logEntry)
        latestDecisionLine = renderer.formatDecisionLine({
          profileName: event.profileName,
          verdict: verdictForLog,
          reason: reasonForLog,
        })

        const progressLine = `Evaluating ${event.index}/${event.total} — ${tally.yes}Y ${tally.maybe}M ${tally.no}N ${tally.error}E`
        evalSpinner.update(latestDecisionLine ? `${progressLine}\n${latestDecisionLine}` : progressLine)
      }

      const evals = await evaluateProfiles({
        profiles,
        model: options.model,
        criteriaText,
        budgetTarget: options.budgetTarget,
        budgetMax: options.budgetMax,
        sleepMs: 400,
        dryRun: options.dryRun,
        onProgress,
        apiKey: env.openaiApiKey,
        signal,
      })

      const report = renderReport({
        evals,
        model: options.model,
        reasoningEffort: options.reasoningEffort,
        verbosity: "low",
        criteriaText,
        maxProfiles: options.maxProfiles,
      })
      const reportFile = join(outputDir, "dj_evaluation_report.md")
      await writeFile(reportFile, report, "utf-8")
      const decisionLogContent = decisionLogEntries.map((entry) => JSON.stringify(entry)).join("\n")
      await writeFile(decisionLogFile, decisionLogContent ? `${decisionLogContent}\n` : "", "utf-8")
      evalSpinner.succeed(`Evaluation complete (${tally.yes}Y ${tally.maybe}M ${tally.no}N ${tally.error}E)`)
    }

    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000)
    renderer.pipelineComplete(elapsedSeconds, outputDir)
    renderer.showFiles(await listGeneratedFiles(outputDir))
    return 0
  } catch (error) {
    if (isRunCancellation(error)) {
      renderer.warn("Run cancelled by user.")
      return 130
    }
    throw error
  } finally {
    dispose()
  }
}

main()
  .then((code) => {
    process.exit(code)
  })
  .catch((error) => {
    if (isCancellationError(error)) {
      console.error("Run cancelled by user.")
      process.exit(130)
    }
    console.error(`Unexpected error: ${getErrorMessage(error)}`)
    process.exit(1)
  })

export const cliEntrypoint = basename(import.meta.url)
