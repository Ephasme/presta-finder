import { appendFileSync } from "node:fs"
import { mkdir, readdir, stat, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"

import { Command } from "commander"
import OpenAI from "openai"
import pLimit from "p-limit"
import { z } from "zod"

import type { ReasoningEffort } from "openai/resources/shared.js"

import { readEnvConfig } from "./config.js"
import { RunStore } from "./db/store.js"
import { evaluateOneProfile, type EvaluationResult } from "./eval/evaluate-profiles.js"
import { loadCriteriaText } from "./eval/load-criteria-template.js"
import { profileTitle } from "./eval/profile-title.js"
import { renderReport } from "./eval/render-report.js"
import type { ProfileTask } from "./pipeline/types.js"
import { getServiceTypeConfig, isServiceTypeId } from "./service-types/registry.js"
import type { ServiceTypeId, SearchContext } from "./service-types/types.js"
import { ALL_PROVIDERS, isProviderName, type ProviderName } from "./providers/registry.js"
import type { Provider, ProviderListResult, VerboseLog } from "./providers/types.js"
import { FileArtifactService } from "./providers/file-artifact-service.js"
import { CacheService } from "./providers/cache-service.js"
import { createRenderer } from "./rendering/index.js"
import type { CliRenderer, FileEntry, ServiceStatus } from "./rendering/types.js"
import { isCancellationError, throwIfAborted } from "./utils/cancel.js"
import { geocode } from "./utils/geocode.js"
import { sleep } from "./utils/sleep.js"

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
  verbose: boolean
  concurrency: number
  minScore: number
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
    .option("--verbose", "Show detailed timing logs", false)
    .option("--concurrency <number>", "Number of parallel workers", "5")
    .option("--min-score <number>", "Minimum score for report inclusion", "60")
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
    .option(
      "--location <location>",
      'Location (city name or "lat,lng")',
      "48.857547499999995,2.3513764999999998",
    )
    .option("--date-from <date>", "Date range start (DD-MM-YYYY)", "28-08-2026")
    .option("--date-to <date>", "Date range end (DD-MM-YYYY)", "28-08-2026")
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
  verbose: z.boolean().default(false),
  concurrency: z
    .union([z.string(), z.number()])
    .transform((v) => Number(v))
    .pipe(z.number().int().min(1).max(20)),
  minScore: z
    .union([z.string(), z.number()])
    .transform((v) => Number(v))
    .pipe(z.number().int().min(0).max(100)),
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
    verbose: opts["verbose"] ?? false,
    concurrency: opts["concurrency"] ?? "5",
    minScore: opts["minScore"] ?? "60",
    providers: opts["providers"] ?? ["all"],
    serviceType: opts["serviceType"] ?? "wedding-dj",
    location: opts["location"] ?? "48.857547499999995,2.3513764999999998",
    dateFrom: opts["dateFrom"] ?? "28-08-2026",
    dateTo: opts["dateTo"] ?? "28-08-2026",
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
    if (!file.endsWith(".json") && !file.endsWith(".md") && !file.endsWith(".jsonl")) {
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

// ── Rate limiter ────────────────────────────────────────────────────

const RATE_LIMIT_MS = 30

// ── Main ────────────────────────────────────────────────────────────

const main = async (): Promise<number> => {
  const startedAt = Date.now()
  const program = createProgram()
  const rawArgs = process.argv.slice(2)
  const normalizedArgs = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs
  program.parse(["node", "presta-finder", ...normalizedArgs])
  const options = parseOptions(program)
  const renderer = createRenderer()
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

    // ════════════════════════════════════════════════════════════════
    // Phase 1: Listing
    // ════════════════════════════════════════════════════════════════

    const cacheServices: CacheService[] = []
    const listingPromises: Array<{
      provider: Provider
      cacheService: CacheService
      promise: Promise<ProviderListResult>
    }> = []

    for (const provider of providers) {
      const artifactService = new FileArtifactService()
      const cacheService = new CacheService(artifactService)
      cacheServices.push(cacheService)

      renderer.listingStarted(provider.displayName)

      listingPromises.push({
        provider,
        cacheService,
        promise: provider.list(
          {
            cacheService,
            dryRun: options.dryRun,
            fetchLimit: options.fetchLimit,
            budgetTarget: options.budgetTarget,
            budgetMax: options.budgetMax,
            verbose: verboseLog,
            signal,
          },
          context,
        ),
      })
    }

    const settled = await Promise.allSettled(
      listingPromises.map((entry) => entry.promise),
    )

    const allTasks: ProfileTask[] = []
    const seenDedupKeys = new Set<string>()

    for (const [i, item] of settled.entries()) {
      const entry = listingPromises[i]

      if (item.status === "fulfilled") {
        const result = item.value
        renderer.listingComplete(
          entry.provider.displayName,
          result.tasks.length,
          result.listingCount,
        )
        // Log listing errors if any
        for (const error of result.errors) {
          renderer.listingError(entry.provider.displayName, error.message)
        }
        // Dedup tasks
        for (const task of result.tasks) {
          if (!seenDedupKeys.has(task.dedupKey)) {
            seenDedupKeys.add(task.dedupKey)
            allTasks.push(task)
          }
        }
      } else {
        const reason: unknown = item.reason
        if (isRunCancellation(reason)) {
          throw reason
        }
        renderer.listingError(
          entry.provider.displayName,
          getErrorMessage(reason),
        )
      }
    }

    throwIfAborted(signal)

    if (allTasks.length === 0) {
      renderer.error("No tasks to process (all providers returned 0 tasks)")
      return 1
    }

    verboseLog?.(
      "cli",
      `listing phase complete: ${allTasks.length} deduped tasks from ${providers.length} providers`,
    )

    // ════════════════════════════════════════════════════════════════
    // Phase 2: Worker pool
    // ════════════════════════════════════════════════════════════════

    const store = await RunStore.open(runId)
    await store.createRun({
      serviceType: options.serviceType,
      model: options.model,
      location: resolvedLocation.text,
    })

    const env = readEnvConfig()
    const client =
      options.dryRun || !env.openaiApiKey ? null : new OpenAI({ apiKey: env.openaiApiKey })

    let criteriaText: string | null = null
    if (!options.collectOnly) {
      criteriaText = loadCriteriaText(options.serviceType)
      const promptFile = join(outputDir, `${options.serviceType}_eval_prompt.md`)
      await writeFile(promptFile, criteriaText, "utf-8")
    }

    const decisionLogFile = join(outputDir, "decision_log.jsonl")
    const providerLastFetch = new Map<string, number>()
    const limit = pLimit(options.concurrency)
    const taskTotal = allTasks.length
    let taskIndex = 0

    const workerTasks = allTasks.map((task) =>
      limit(async () => {
        taskIndex += 1
        const currentIndex = taskIndex
        const worker = 1 + ((currentIndex - 1) % options.concurrency)

        try {
          throwIfAborted(signal)

          // 0. Per-provider rate limit
          const lastFetch = providerLastFetch.get(task.provider) ?? 0
          const elapsed = Date.now() - lastFetch
          if (elapsed < RATE_LIMIT_MS) {
            await sleep(RATE_LIMIT_MS - elapsed, signal)
          }

          // 1. Fetch + parse + normalize
          renderer.updateWorkerProgress({
            taskIndex: currentIndex,
            taskTotal,
            worker,
            workerTotal: options.concurrency,
            provider: task.provider,
            target: task.target,
            phase: "fetching",
          })

          const profile = await task.execute(signal)
          providerLastFetch.set(task.provider, Date.now())

          // 2. Persist profile
          const profileId = await store.insertProfile(profile)

          // 3. Evaluate (skip if --collect-only)
          let evalResult: EvaluationResult | null = null
          if (!options.collectOnly && criteriaText) {
            renderer.updateWorkerProgress({
              taskIndex: currentIndex,
              taskTotal,
              worker,
              workerTotal: options.concurrency,
              provider: task.provider,
              target: task.target,
              phase: "evaluating",
            })

            evalResult = await evaluateOneProfile({
              profile,
              client,
              model: options.model,
              reasoningEffort: options.reasoningEffort,
              criteriaText,
              dryRun: options.dryRun,
              signal,
            })

            await store.insertEvaluation(profileId, {
              score: evalResult.evaluation?.score ?? null,
              verdict: evalResult.evaluation?.verdict ?? null,
              summary: evalResult.evaluation?.summary ?? null,
              evalJson: evalResult.evaluation ?? null,
              error: evalResult.error,
              rawOutput: evalResult.rawOutput,
              requestId: evalResult.requestId ?? null,
            })
          }

          // 4. Decision log entry (real-time)
          const verdictForLog: DecisionVerdict = evalResult?.error
            ? "error"
            : (evalResult?.evaluation?.verdict ?? "unknown")
          const reasonForLog = (
            evalResult?.evaluation?.summary ??
            evalResult?.error ??
            "No evaluation"
          ).trim()

          const logEntry: DecisionLogEntry = {
            timestamp: new Date().toISOString(),
            index: currentIndex,
            total: taskTotal,
            profileName: profileTitle(profile),
            provider: profile.provider,
            link: profile.profileUrl ?? null,
            verdict: verdictForLog,
            reason: reasonForLog,
          }
          appendFileSync(decisionLogFile, `${JSON.stringify(logEntry)}\n`)

          // 5. Report progress
          renderer.updateWorkerProgress({
            taskIndex: currentIndex,
            taskTotal,
            worker,
            workerTotal: options.concurrency,
            provider: task.provider,
            target: task.target,
            phase: "done",
            verdict: evalResult?.evaluation?.verdict ?? undefined,
            score: evalResult?.evaluation?.score ?? undefined,
          })
        } catch (error) {
          if (isRunCancellation(error)) {
            throw error
          }
          renderer.updateWorkerProgress({
            taskIndex: currentIndex,
            taskTotal,
            worker,
            workerTotal: options.concurrency,
            provider: task.provider,
            target: task.target,
            phase: "error",
          })
          renderer.warn(
            `Task error (${task.provider}/${task.target}): ${getErrorMessage(error)}`,
          )
        }
      }),
    )

    await Promise.allSettled(workerTasks)

    // Re-throw cancellation if it happened
    if (signal.aborted) {
      throw signal.reason
    }

    // ════════════════════════════════════════════════════════════════
    // Phase 2b: Flush caches
    // ════════════════════════════════════════════════════════════════

    for (const cacheService of cacheServices) {
      try {
        const persistedFiles = await cacheService.flushPendingArtifacts()
        if (persistedFiles.length > 0) {
          verboseLog?.("cli", `flushed ${persistedFiles.length} cache artifact(s)`)
        }
      } catch (error) {
        verboseLog?.("cli", `cache flush failed: ${getErrorMessage(error)}`)
      }
    }

    // ════════════════════════════════════════════════════════════════
    // Phase 3: Consolidation
    // ════════════════════════════════════════════════════════════════

    if (!options.collectOnly) {
      const results = await store.getEvaluatedProfiles(options.minScore)
      const serviceTypeConfig = getServiceTypeConfig(options.serviceType)

      // Convert EvaluationRow[] to EvaluationResult[] for renderReport
      const evalResults: EvaluationResult[] = results.map((row) => ({
        profile: row.profile,
        evaluation: row.evalJson,
        error: row.error,
        rawOutput: row.rawOutput,
        requestId: row.requestId,
      }))

      const report = renderReport({
        evals: evalResults,
        model: options.model,
        reasoningEffort: options.reasoningEffort,
        verbosity: "low",
        criteriaText: criteriaText ?? "",
        serviceTypeLabel: serviceTypeConfig.label,
      })
      const reportFile = join(outputDir, `${options.serviceType}_evaluation_report.md`)
      await writeFile(reportFile, report, "utf-8")
    }

    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000)
    renderer.pipelineComplete(elapsedSeconds, outputDir)
    renderer.showFiles(await listGeneratedFiles(outputDir))

    store.close()
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
