import { describe, expect, it } from "vitest"

import { buildUrl } from "../../src/utils/url.js"

describe("buildUrl", () => {
  it("encodes query params", () => {
    const url = buildUrl("https://example.com", {
      a: 1,
      b: "hello world",
      c: ["x", "y"],
      empty: null,
    })
    expect(url).toContain("a=1")
    expect(url).toContain("b=hello+world")
    expect(url).toContain("c=x")
    expect(url).toContain("c=y")
    expect(url).not.toContain("empty")
  })
})
