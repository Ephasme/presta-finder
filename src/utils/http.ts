import { readFile } from "node:fs/promises"
import { z } from "zod"

export type HttpHeaders = Record<string, string>

export interface HttpResponse<TBody> {
  status: number
  contentType: string
  body: TBody
}

const recordSchema = z.record(z.string(), z.unknown())

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
    if (typeof value === "string") {
      merged[key] = value
    } else if (typeof value === "number" || typeof value === "boolean") {
      merged[key] = value.toString()
    } else {
      merged[key] = JSON.stringify(value)
    }
  }
  return merged
}

export const parseJsonArg = async (
  value: string | null | undefined,
): Promise<Record<string, unknown>> => {
  if (!value) {
    return {}
  }
  let raw: unknown
  if (value.startsWith("@")) {
    const path = value.slice(1)
    const content = await readFile(path, "utf-8")
    raw = JSON.parse(content)
  } else {
    raw = JSON.parse(value)
  }
  const parsed = recordSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error("JSON argument must be an object")
  }
  return parsed.data
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

export const httpGetJson = async (
  url: string,
  timeoutMs: number,
  headers: HttpHeaders,
  signal?: AbortSignal,
): Promise<HttpResponse<unknown>> => {
  const response = await fetch(url, {
    method: "GET",
    headers,
    signal: withTimeoutSignal(timeoutMs, signal),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} on GET ${url}`)
  }
  const textResp = await readResponseText(response)
  const parsedBody: unknown = JSON.parse(textResp.body)
  return {
    ...textResp,
    body: parsedBody,
  }
}

export const httpPostJson = async (
  url: string,
  body: unknown,
  timeoutMs: number,
  headers: HttpHeaders,
  signal?: AbortSignal,
): Promise<HttpResponse<unknown>> => {
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
    const snippet = textResp.body.replaceAll(/\s+/g, " ").slice(0, 200)
    throw new Error(`HTTP ${response.status} on POST ${url}: ${snippet}`)
  }
  let parsedBody: unknown
  try {
    parsedBody = JSON.parse(textResp.body)
  } catch {
    const snippet = textResp.body.replaceAll(/\s+/g, " ").slice(0, 200)
    const contentType = textResp.contentType || "unknown"
    throw new Error(
      `Invalid JSON response from POST ${url} (status=${response.status}, content-type=${contentType}): ${snippet}`,
    )
  }
  return {
    ...textResp,
    body: parsedBody,
  }
}

export const httpPostText = async (
  url: string,
  body: unknown,
  timeoutMs: number,
  headers: HttpHeaders,
  signal?: AbortSignal,
): Promise<HttpResponse<string>> => {
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
    const snippet = textResp.body.replaceAll(/\s+/g, " ").slice(0, 200)
    throw new Error(`HTTP ${response.status} on POST ${url}: ${snippet}`)
  }
  return textResp
}
