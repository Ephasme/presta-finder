export const coerceInt = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    return Number.parseInt(value, 10)
  }
  return null
}

const normalizeFloatString = (value: string): string | null => {
  const compact = value.replaceAll(/[\s\u00a0\u202f]/g, "").trim()
  if (!compact || !/^[+-]?[0-9][0-9.,]*$/.test(compact)) {
    return null
  }

  const sign = compact[0] === "-" || compact[0] === "+" ? compact[0] : ""
  const digits = sign ? compact.slice(1) : compact
  const commaCount = (digits.match(/,/g) ?? []).length
  const dotCount = (digits.match(/\./g) ?? []).length

  if (commaCount > 0 && dotCount > 0) {
    const lastComma = digits.lastIndexOf(",")
    const lastDot = digits.lastIndexOf(".")
    if (lastComma > lastDot) {
      return `${sign}${digits.replaceAll(".", "").replaceAll(",", ".")}`
    }
    return `${sign}${digits.replaceAll(",", "")}`
  }

  if (commaCount > 0) {
    if (commaCount === 1) {
      return `${sign}${digits.replace(",", ".")}`
    }
    const lastComma = digits.lastIndexOf(",")
    const intPart = digits.slice(0, lastComma).replaceAll(",", "")
    const fracPart = digits.slice(lastComma + 1)
    return `${sign}${intPart}.${fracPart}`
  }

  if (dotCount > 1) {
    const lastDot = digits.lastIndexOf(".")
    const intPart = digits.slice(0, lastDot).replaceAll(".", "")
    const fracPart = digits.slice(lastDot + 1)
    return `${sign}${intPart}.${fracPart}`
  }

  return `${sign}${digits}`
}

export const coerceFloat = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string") {
    const normalized = normalizeFloatString(value)
    if (normalized === null) {
      return null
    }
    const parsed = Number.parseFloat(normalized)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}
