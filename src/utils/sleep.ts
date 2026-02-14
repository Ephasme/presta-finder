import { throwIfAborted, toCancellationError } from "./cancel.js"

export const sleep = async (ms: number, signal?: AbortSignal): Promise<void> => {
  if (ms <= 0) {
    return
  }
  throwIfAborted(signal)
  if (!signal) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms)
    })
    return
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", onAbort)
      reject(toCancellationError(signal))
    }
    signal.addEventListener("abort", onAbort, { once: true })
  })
}
