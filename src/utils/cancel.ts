export class CancellationError extends Error {
  constructor(message = "Operation cancelled") {
    super(message)
    this.name = "CancellationError"
  }
}

export const toCancellationError = (signal: AbortSignal): CancellationError => {
  const reason = signal.reason
  if (reason instanceof Error) {
    return new CancellationError(reason.message)
  }
  if (typeof reason === "string" && reason.trim()) {
    return new CancellationError(reason)
  }
  return new CancellationError()
}

export const throwIfAborted = (signal: AbortSignal | undefined): void => {
  if (!signal?.aborted) {
    return
  }
  throw toCancellationError(signal)
}

export const isCancellationError = (value: unknown): boolean => {
  if (value instanceof CancellationError) {
    return true
  }
  if (!(value instanceof Error)) {
    return false
  }
  return value.name === "AbortError" || value.name === "CancellationError"
}
