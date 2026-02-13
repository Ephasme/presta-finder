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

export interface ProgressTracker {
  onProgress(current: number, total: number, status?: string): void
  setStatus(status: string): void
}

export interface SpinnerHandle {
  update(text: string): void
  succeed(text: string): void
  fail(text: string): void
  warn(text: string): void
}

export interface CliRenderer {
  header(runId: string, outputDir: string, dryRun: boolean): void
  envTable(services: ServiceStatus[]): void
  fetchStarted(displayName: string): void
  createProgressTracker(providerName: string): ProgressTracker
  stopProgress(): void
  providerSuccess(displayName: string, profileCount: number): void
  providerSkipped(displayName: string): void
  providerError(displayName: string, errorMessage: string): void
  providerCancelled(displayName: string): void
  createSpinner(text: string): SpinnerHandle
  formatDecisionLine(entry: DecisionLineEntry): string
  logVerbose(provider: string, message: string, elapsedSec: number): void
  pipelineComplete(elapsedSeconds: number, outputDir: string): void
  showFiles(files: FileEntry[]): void
  warn(message: string): void
  error(message: string): void
}
