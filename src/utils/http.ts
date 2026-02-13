import { readFile } from "node:fs/promises"

export type HttpHeaders = Record<string, string>

export interface HttpResponse<TBody> {
  status: number
  contentType: string
  body: TBody
}

const withTimeoutSignal = (timeoutMs: number, signal?: AbortSignal): AbortSignal => {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal
}

export const mergeHeaders = (
  base: HttpHeaders,
  extra: Record<string, unknown> | null | undefined,
): HttpHeaders => {
  const merged: HttpHeaders = { ...base }
  if (!extra) {
    return merged
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value === null || value === undefined) {
      continue
    }
    merged[String(key)] = String(value)
  }
  return merged
}

export const parseJsonArg = async (value: string | null | undefined): Promise<Record<string, unknown>> => {
  if (!value) {
    return {}
  }
  let parsed: unknown
  if (value.startsWith("@")) {
    const path = value.slice(1)
    const content = await readFile(path, "utf-8")
    parsed = JSON.parse(content)
  } else {
    parsed = JSON.parse(value)
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON argument must be an object")
  }
  return parsed as Record<string, unknown>
}

const readResponseText = async (response: Response): Promise<HttpResponse<string>> => ({
  status: response.status,
  contentType: response.headers.get("content-type") ?? "",
  body: await response.text(),
})

export const httpGetText = async (
  url: string,
  timeoutMs: number,
  headers: HttpHeaders,
  signal?: AbortSignal,
): Promise<HttpResponse<string>> => {
  const response = await fetch(url, {
    method: "GET",
    headers,
    signal: withTimeoutSignal(timeoutMs, signal),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} on GET ${url}`)
  }
  return readResponseText(response)
}

export const httpGetJson = async <T = unknown>(
  url: string,
  timeoutMs: number,
  headers: HttpHeaders,
  signal?: AbortSignal,
): Promise<HttpResponse<T>> => {
  const response = await fetch(url, {
    method: "GET",
    headers,
    signal: withTimeoutSignal(timeoutMs, signal),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} on GET ${url}`)
  }
  const textResp = await readResponseText(response)
  return {
    ...textResp,
    body: JSON.parse(textResp.body) as T,
  }
}

export const httpPostJson = async <TResponse = unknown>(
  url: string,
  body: unknown,
  timeoutMs: number,
  headers: HttpHeaders,
  signal?: AbortSignal,
): Promise<HttpResponse<TResponse>> => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
    signal: withTimeoutSignal(timeoutMs, signal),
  })

  const textResp = await readResponseText(response)
  if (!response.ok) {
    const snippet = textResp.body.replace(/\s+/g, " ").slice(0, 200)
    throw new Error(`HTTP ${response.status} on POST ${url}: ${snippet}`)
  }
  return {
    ...textResp,
    body: JSON.parse(textResp.body) as TResponse,
  }
}
