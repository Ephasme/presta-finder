export type VerboseLog = (provider: string, message: string) => void

export interface ServiceStatus {
  name: string
  ready: boolean
  required?: boolean
}

export interface FileEntry {
  name: string
  sizeKb: string
  isReport: boolean
}

export interface DecisionLineEntry {
  profileName: string
  verdict: "yes" | "maybe" | "no" | "error" | "unknown"
  reason: string
}

export interface WorkerProgressEvent {
  taskIndex: number
  taskTotal: number
  worker: number
  workerTotal: number
  provider: string
  target: string
  phase: "fetching" | "evaluating" | "done" | "error"
  verdict?: "yes" | "maybe" | "no"
  score?: number
}

export interface CliRenderer {
  // --- Setup ---
  header(
    runId: string,
    outputDir: string,
    dryRun: boolean,
    model: string,
    reasoningEffort: string | null,
  ): void
  envTable(services: ServiceStatus[]): void

  // --- Phase 1: Listing ---
  listingStarted(displayName: string): void
  listingComplete(displayName: string, taskCount: number, listingCount: number): void
  listingError(displayName: string, errorMessage: string): void
  listingSkipped(displayName: string): void

  // --- Phase 2: Worker pool ---
  updateWorkerProgress(event: WorkerProgressEvent): void
  formatDecisionLine(entry: DecisionLineEntry): string

  // --- General ---
  logVerbose(provider: string, message: string, elapsedSec: number): void
  pipelineComplete(elapsedSeconds: number, outputDir: string): void
  showFiles(files: FileEntry[]): void
  warn(message: string): void
  error(message: string): void
}
