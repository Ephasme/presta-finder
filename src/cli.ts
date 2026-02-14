import { mkdir, readdir, stat, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"

import { Command } from "commander"
import { z } from "zod"

import type { ReasoningEffort } from "openai/resources/shared.js"

import { readEnvConfig } from "./config.js"
import { evaluateProfiles, type EvalProgressEvent } from "./eval/evaluate-profiles.js"
import { loadCriteriaText } from "./eval/load-criteria-template.js"
import { renderReport } from "./eval/render-report.js"
import { mergeProfiles } from "./merge/merge-profiles.js"
import type { AnyServiceProfile } from "./service-types/merged.js"
import { getServiceTypeConfig, isServiceTypeId } from "./service-types/registry.js"
import type { ServiceTypeId, SearchContext } from "./service-types/types.js"
import { ALL_PROVIDERS, isProviderName, type ProviderName } from "./providers/registry.js"
import type { Provider, VerboseLog } from "./providers/types.js"
import { FileArtifactService } from "./providers/file-artifact-service.js"
import { CacheService } from "./providers/cache-service.js"
import { createRenderer } from "./rendering/index.js"
import type { CliRenderer, FileEntry, ServiceStatus } from "./rendering/types.js"
import { isCancellationError, throwIfAborted } from "./utils/cancel.js"
import { geocode } from "./utils/geocode.js"

type ProviderArg = ProviderName | "all"
type DecisionVerdict = "yes" | "maybe" | "no" | "error" | "unknown"

interface ResolvedLocation {
  lat: number
  lng: number
  text: string
}

interface CliOptions {
  outputDir: string
  runId?: string
  collectOnly: boolean
  dryRun: boolean
  plain: boolean
  verbose: boolean
  profileConcurrency: boolean
  providers: ProviderArg[]
  serviceType: ServiceTypeId
  location: string
  dateFrom: string
  dateTo: string
  fetchLimit?: number
  budgetTarget: number
  budgetMax: number
  model: string
  reasoningEffort: ReasoningEffort
}

interface DecisionLogEntry {
  timestamp: string
  index: number
  total: number
  profileName: string
  provider: string
  link: string | null
  verdict: DecisionVerdict
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

const providerArgSchema = z
  .string()
  .refine((s: string) => s === "all" || isProviderName(s), {
    message: `Invalid provider. Use one of: all ${ALL_PROVIDERS.map((p) => p.name).join(" ")}`,
  })
  .transform((s): ProviderArg => {
    if (s === "all") return s
    if (isProviderName(s)) return s
    throw new Error("Invalid provider arg")
  })

const providerArgsSchema = z.preprocess(
  (val) => (Array.isArray(val) ? val.map((v) => String(v)) : ["all"]),
  z.array(providerArgSchema).transform((arr): ProviderArg[] => (arr.length === 0 ? ["all"] : arr)),
)

const resolveProviders = (requested: ProviderArg[], serviceTypeId: ServiceTypeId): Provider[] => {
  const candidates = requested.some((arg) => arg === "all")
    ? [...ALL_PROVIDERS]
    : ALL_PROVIDERS.filter((p) => new Set(requested).has(p.name))

  return candidates.filter((p) => p.capabilities.some((cap) => cap.serviceTypeId === serviceTypeId))
}

const createProgram = (): Command => {
  const program = new Command()
  program
    .name("presta-finder")
    .description("Provider profile research pipeline")
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
    .option(
      "--service-type <type>",
      "Service type (e.g. wedding-dj, kids-entertainer)",
      "wedding-dj",
    )
    .option("--location <location>", 'Location (city name or "lat,lng")', "48.98,1.98")
    .option("--date-from <date>", "Date range start (DD-MM-YYYY)", "01-06-2025")
    .option("--date-to <date>", "Date range end (DD-MM-YYYY)", "30-09-2025")
    .option("--fetch-limit <number>", "Max profiles to fetch per provider")
    .option("--budget-target <number>", "Target budget", "1000")
    .option("--budget-max <number>", "Max budget", "1300")
    .option("--model <name>", "OpenAI model", "gpt-5-nano")
    .option("--reasoning-effort <level>", "Reasoning effort", "low")
  return program
}

const cliOptionsSchema = z.object({
  outputDir: z.string().default("output"),
  runId: z.string().optional(),
  collectOnly: z.boolean().default(false),
  dryRun: z.boolean().default(false),
  plain: z.boolean().default(false),
  verbose: z.boolean().default(false),
  profileConcurrency: z.boolean().default(true),
  providers: providerArgsSchema,
  serviceType: z
    .string()
    .refine((s) => isServiceTypeId(s), "Unknown service type")
    .transform((s): ServiceTypeId => {
      if (isServiceTypeId(s)) return s
      throw new Error("Unknown service type")
    }),
  location: z.string(),
  dateFrom: z.string(),
  dateTo: z.string(),
  fetchLimit: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v !== undefined ? Number(v) : undefined)),
  budgetTarget: z.union([z.string(), z.number()]).transform((v) => Number(v)),
  budgetMax: z.union([z.string(), z.number()]).transform((v) => Number(v)),
  model: z.string(),
  reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh"]),
})

const parseOptions = (program: Command): CliOptions => {
  const opts = program.opts<Record<string, unknown>>()
  const raw = {
    outputDir: opts["outputDir"] ?? "output",
    runId: opts["runId"],
    collectOnly: opts["collectOnly"] ?? false,
    dryRun: opts["dryRun"] ?? false,
    plain: opts["plain"] ?? false,
    verbose: opts["verbose"] ?? false,
    profileConcurrency: opts["profileConcurrency"] ?? true,
    providers: opts["providers"] ?? ["all"],
    serviceType: opts["serviceType"] ?? "wedding-dj",
    location: opts["location"] ?? "48.98,1.98",
    dateFrom: opts["dateFrom"] ?? "01-06-2025",
    dateTo: opts["dateTo"] ?? "30-09-2025",
    fetchLimit: opts["fetchLimit"],
    budgetTarget: opts["budgetTarget"] ?? "1000",
    budgetMax: opts["budgetMax"] ?? "1300",
    model: opts["model"] ?? "gpt-5-nano",
    reasoningEffort: opts["reasoningEffort"] ?? "low",
  }
  const parsed = cliOptionsSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue.path.join(".")
    throw new Error(`Invalid option${path ? ` (${path})` : ""}: ${issue.message}`)
  }
  return parsed.data
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

interface SigintCancellationHandle {
  signal: AbortSignal
  dispose: () => void
}

const setupSigintCancellation = (renderer: CliRenderer): SigintCancellationHandle => {
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

interface ProviderTaskResult {
  providerName: string
  displayName: string
  profiles: AnyServiceProfile[]
  profileCount: number
  listingCount?: number
  fetchedCount?: number
  fetchLimit?: number
  errorCount: number
}

class ProviderRunError extends Error {
  readonly displayName: string
  readonly cause: unknown

  constructor(displayName: string, cause: unknown) {
    super(
      `Provider "${displayName}" failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
    this.name = "ProviderRunError"
    this.displayName = displayName
    this.cause = cause
  }
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
  const isRunCancellation = (error: unknown): boolean =>
    signal.aborted && isCancellationError(error)

  try {
    const runId = options.runId ?? nowRunId()
    const outputDir = join(options.outputDir, runId)
    await mkdir(outputDir, { recursive: true })

    renderer.header(runId, outputDir, options.dryRun, options.model, options.reasoningEffort)
    renderer.envTable(buildServiceStatusEntries())

    // Geocode the location
    let resolvedLocation: ResolvedLocation
    try {
      resolvedLocation = await geocode(options.location, signal)
    } catch (error) {
      renderer.error(`Geocoding failed: ${getErrorMessage(error)}`)
      return 1
    }

    const providers = resolveProviders(options.providers, options.serviceType)
    if (providers.length === 0) {
      renderer.error(
        `No providers support service type "${options.serviceType}" among the selected providers.`,
      )
      return 1
    }

    const context: SearchContext = {
      serviceType: options.serviceType,
      location: {
        lat: resolvedLocation.lat,
        lng: resolvedLocation.lng,
        text: resolvedLocation.text,
        city: null,
        postcode: null,
        department: null,
        region: null,
        country: null,
      },
      date: {
        from: options.dateFrom,
        to: options.dateTo,
      },
    }

    const t0 = Date.now()
    const verboseLog: VerboseLog | undefined = options.verbose
      ? (provider, message) => {
          const elapsed = (Date.now() - t0) / 1000
          renderer.logVerbose(provider, message, elapsed)
        }
      : undefined

    const tasks: Array<Promise<ProviderTaskResult>> = []

    for (const provider of providers) {
      const artifactService = new FileArtifactService({
        outputFile: join(outputDir, `raw_${provider.name}.json`),
        providerId: provider.name,
      })
      const cacheService = new CacheService(artifactService)
      renderer.fetchStarted(provider.displayName)
      const progress = renderer.createProgressTracker(provider.name)

      tasks.push(
        (async (): Promise<ProviderTaskResult> => {
          try {
            verboseLog?.(provider.name, "task started")
            const result = await provider.run(
              {
                outputDir,
                cacheService,
                dryRun: options.dryRun,
                profileConcurrency: options.profileConcurrency ? 4 : 1,
                fetchLimit: options.fetchLimit,
                budgetTarget: options.budgetTarget,
                budgetMax: options.budgetMax,
                onProgress: (current, total, status) => {
                  progress.onProgress(current, total, status)
                },
                verbose: verboseLog,
                signal,
              },
              context,
            )
            verboseLog?.(
              provider.name,
              `task finished (profiles=${result.profileCount}, errors=${result.errors.length})`,
            )

            // Log non-fatal errors if verbose
            if (options.verbose && result.errors.length > 0) {
              for (const error of result.errors) {
                verboseLog?.(provider.name, `${error.step} error (${error.code}): ${error.message}`)
              }
            }

            progress.setStatus("done")
            return {
              providerName: provider.name,
              displayName: provider.displayName,
              profiles: result.profiles,
              profileCount: result.profileCount,
              listingCount: result.listingCount,
              fetchedCount: result.fetchedCount,
              fetchLimit: result.fetchLimit,
              errorCount: result.errors.length,
            }
          } catch (error) {
            verboseLog?.(provider.name, `task errored: ${getErrorMessage(error)}`)
            progress.setStatus(isRunCancellation(error) ? "cancelled" : "error")
            throw new ProviderRunError(provider.displayName, error)
          }
        })(),
      )
    }
    verboseLog?.(
      "cli",
      `scheduled ${tasks.length} provider tasks (running with Promise.allSettled)`,
    )

    const settled = await Promise.allSettled(tasks)
    verboseLog?.("cli", "all provider tasks settled")
    renderer.stopProgress()

    const allProviderProfiles: AnyServiceProfile[][] = []
    for (const item of settled) {
      if (item.status === "fulfilled") {
        const run = item.value
        allProviderProfiles.push(run.profiles)

        if (run.errorCount > 0) {
          verboseLog?.(
            "cli",
            `${run.providerName} completed with ${run.errorCount} non-fatal errors`,
          )
        }
        renderer.providerSuccess(run.displayName, {
          profileCount: run.profileCount,
          listingCount: run.listingCount,
          fetchedCount: run.fetchedCount,
          fetchLimit: run.fetchLimit,
        })
        continue
      }

      const reason: unknown = item.reason
      if (reason instanceof ProviderRunError) {
        if (isRunCancellation(reason.cause)) {
          renderer.providerCancelled(reason.displayName)
          throw reason.cause
        }
        renderer.providerError(reason.displayName, getErrorMessage(reason.cause))
      } else {
        throw reason
      }
    }

    throwIfAborted(signal)
    if (allProviderProfiles.length === 0) {
      renderer.error("No provider output available")
      return 1
    }

    const mergeSpinner = renderer.createSpinner("Merging profiles")
    let mergedProfiles: AnyServiceProfile[] = []
    try {
      mergedProfiles = mergeProfiles(allProviderProfiles)
      throwIfAborted(signal)
      const mergedFile = join(outputDir, "merged_profiles.json")
      await writeFile(mergedFile, `${JSON.stringify(mergedProfiles, null, 2)}\n`, "utf-8")
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

      const tally = { yes: 0, maybe: 0, no: 0, error: 0 }
      let latestDecisionLine: string | null = null
      const decisionLogEntries: DecisionLogEntry[] = []
      const lastDecisionByWorker = new Map<number, string>()
      let workerCount = 0

      const criteriaText = loadCriteriaText(options.serviceType, {
        budgetTarget: options.budgetTarget,
        budgetMax: options.budgetMax,
      })
      const promptFile = join(outputDir, `${options.serviceType}_eval_prompt.md`)
      await writeFile(promptFile, criteriaText, "utf-8")

      const onProgress = (event: EvalProgressEvent): void => {
        if (event.error) {
          tally.error += 1
        } else if (event.verdict) {
          tally[event.verdict] += 1
        }

        const verdictForLog: DecisionVerdict = event.error ? "error" : (event.verdict ?? "unknown")
        const reasonForLog = (event.reason ?? event.error ?? "No reasoning provided").trim()
        const logEntry: DecisionLogEntry = {
          timestamp: new Date().toISOString(),
          index: event.index,
          total: event.total,
          profileName: event.profileName,
          provider: event.provider,
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
        workerCount = Math.max(workerCount, event.workerTotal)
        lastDecisionByWorker.set(event.worker, `W${event.worker} ${latestDecisionLine}`)

        const progressLine = `Evaluating ${event.index}/${event.total} — ${tally.yes}Y ${tally.maybe}M ${tally.no}N ${tally.error}E`
        const workerLines =
          workerCount > 0
            ? Array.from({ length: workerCount }, (_, idx) => {
                const worker = idx + 1
                return (
                  lastDecisionByWorker.get(worker) ?? `W${worker} waiting for first decision...`
                )
              })
            : []
        const separator = "─".repeat(80)
        const displayLines =
          workerLines.length > 0
            ? [progressLine, separator, workerLines.join(`\n${separator}\n`)]
            : [progressLine]
        evalSpinner.update(displayLines.join("\n"))
      }

      const evals = await evaluateProfiles({
        profiles: mergedProfiles,
        model: options.model,
        reasoningEffort: options.reasoningEffort,
        criteriaText,
        concurrency: 4,
        dryRun: options.dryRun,
        onProgress,
        apiKey: env.openaiApiKey,
        signal,
      })

      const serviceTypeConfig = getServiceTypeConfig(options.serviceType)
      const report = renderReport({
        evals,
        model: options.model,
        reasoningEffort: options.reasoningEffort,
        verbosity: "low",
        criteriaText,
        serviceTypeLabel: serviceTypeConfig.label,
      })
      const reportFile = join(outputDir, `${options.serviceType}_evaluation_report.md`)
      await writeFile(reportFile, report, "utf-8")
      const decisionLogContent = decisionLogEntries.map((entry) => JSON.stringify(entry)).join("\n")
      await writeFile(decisionLogFile, decisionLogContent ? `${decisionLogContent}\n` : "", "utf-8")
      evalSpinner.succeed(
        `Evaluation complete (${tally.yes}Y ${tally.maybe}M ${tally.no}N ${tally.error}E)`,
      )
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
  .catch((error: unknown) => {
    if (isCancellationError(error)) {
      console.error("Run cancelled by user.")
      process.exit(130)
    }
    console.error(`Unexpected error: ${getErrorMessage(error)}`)
    process.exit(1)
  })

export const cliEntrypoint = basename(import.meta.url)
