import { describe, expect, it } from "vitest"

import { coerceFloat, coerceInt } from "../../src/utils/coerce.js"

describe("coerce utils", () => {
  it("coerces ints safely", () => {
    expect(coerceInt(10)).toBe(10)
    expect(coerceInt("20")).toBe(20)
    expect(coerceInt("abc")).toBeNull()
  })

  it("coerces floats safely", () => {
    expect(coerceFloat(10.5)).toBe(10.5)
    expect(coerceFloat("20.2")).toBe(20.2)
    expect(coerceFloat("4,9")).toBe(4.9)
    expect(coerceFloat("1 234,56")).toBe(1234.56)
    expect(coerceFloat("1,234.56")).toBe(1234.56)
    expect(coerceFloat("1.234,56")).toBe(1234.56)
    expect(coerceFloat("abc")).toBeNull()
  })
})
