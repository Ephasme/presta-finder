import { throwIfAborted } from "./cancel.js"
import { sleep } from "./sleep.js"

export interface PaginateUntilConfig<T> {
  fetchPage: (page: number) => Promise<T[]>
  firstPage?: number
  sleepBetweenMs?: number
  maxPages?: number
  signal?: AbortSignal
}

/**
 * Async generator that fetches pages sequentially and yields each page's
 * results. The **caller** decides when to stop by breaking out of the loop.
 */
export async function* paginateUntil<T>(
  config: PaginateUntilConfig<T>,
): AsyncGenerator<{ page: number; items: T[] }, void, undefined> {
  const firstPage = config.firstPage ?? 1
  const maxPages = config.maxPages ?? 200
  const sleepBetweenMs = config.sleepBetweenMs ?? 0

  for (let i = 0; i < maxPages; i += 1) {
    const page = firstPage + i
    throwIfAborted(config.signal)

    const items = await config.fetchPage(page)
    yield { page, items }

    if (sleepBetweenMs > 0 && i < maxPages - 1) {
      await sleep(sleepBetweenMs, config.signal)
    }
  }
}
