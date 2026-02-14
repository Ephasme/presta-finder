import { describe, expect, it } from "vitest"

import { sanitizeForError } from "../../src/providers/types.js"

describe("sanitizeForError", () => {
  it("strips Bearer tokens from messages", () => {
    const input = "Request failed with Bearer sk_test_123456789abcdefghij"
    const sanitized = sanitizeForError(input)

    expect(sanitized).toBe("Request failed with Bearer [REDACTED]")
    expect(sanitized).not.toContain("sk_test_123456789")
  })

  it("strips Basic auth credentials from messages", () => {
    const input = "Auth error with Basic dXNlcjpwYXNzd29yZA=="
    const sanitized = sanitizeForError(input)

    expect(sanitized).toBe("Auth error with Basic [REDACTED]")
    expect(sanitized).not.toContain("dXNlcjpwYXNzd29yZA")
  })

  it("strips sensitive query parameters from URLs", () => {
    const input = "https://api.example.com/fetch?api_key=secret123&format=json"
    const sanitized = sanitizeForError(input)

    // URL encoding: [REDACTED] becomes %5BREDACTED%5D
    expect(sanitized).toMatch(/api_key=(%5B|\\[)REDACTED(%5D|\\])/)
    expect(sanitized).not.toContain("secret123")
    expect(sanitized).toContain("format=json")
  })

  it("strips multiple sensitive parameters", () => {
    const input = "https://api.example.com/data?token=abc&apikey=xyz&page=1"
    const sanitized = sanitizeForError(input)

    // URL encoding: [REDACTED] becomes %5BREDACTED%5D
    expect(sanitized).toMatch(/token=(%5B|\\[)REDACTED(%5D|\\])/)
    expect(sanitized).toMatch(/apikey=(%5B|\\[)REDACTED(%5D|\\])/)
    expect(sanitized).toContain("page=1")
    expect(sanitized).not.toContain("abc")
    expect(sanitized).not.toContain("xyz")
  })

  it("truncates long messages to 200 characters", () => {
    const input = "x".repeat(250)
    const sanitized = sanitizeForError(input)

    expect(sanitized.length).toBe(200)
    expect(sanitized).toMatch(/\.\.\.$/)
  })

  it("handles non-URL strings with sensitive keywords gracefully", () => {
    const input = "Error: invalid api_key provided"
    const sanitized = sanitizeForError(input)

    // Non-URL, so regex fallback should not break the string
    expect(sanitized).toBe(input)
  })

  it("preserves non-sensitive content unchanged", () => {
    const input = "Profile not found at https://example.com/profile/123"
    const sanitized = sanitizeForError(input)

    expect(sanitized).toBe(input)
  })

  it("handles empty strings", () => {
    const sanitized = sanitizeForError("")
    expect(sanitized).toBe("")
  })
})
