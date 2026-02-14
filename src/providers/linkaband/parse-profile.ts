import * as cheerio from "cheerio"

import { parseGenericProfilePage, type ParsedProfilePage } from "../profile-page.js"
import { coerceFloat, coerceInt } from "../../utils/coerce.js"

const normalizeSpaces = (text: string): string =>
  text
    .replaceAll("\n", " ")
    .replaceAll("\t", " ")
    .replaceAll("\r", " ")
    .replaceAll("\u00a0", " ")
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" ")

interface HeaderRating {
  ratingValue: number | null
  ratingCount: number | null
}

const parseHeaderRating = (text: string): HeaderRating => {
  const normalized = normalizeSpaces(text)
  if (!normalized) {
    return { ratingValue: null, ratingCount: null }
  }

  const match = /(?:^|\s)([0-5](?:[.,][0-9]+)?)\s*\(\s*([0-9][0-9 .,\u00a0]*)\s*\)(?=\s|$)/.exec(
    normalized,
  )
  if (!match) {
    return { ratingValue: null, ratingCount: null }
  }

  const ratingValueRaw = match[1].replaceAll(",", ".")
  const ratingValue = coerceFloat(ratingValueRaw)
  const ratingCountRaw = match[2].replaceAll(/[^0-9]/g, "")
  const ratingCount = coerceInt(ratingCountRaw)
  if (ratingValue === null || ratingValue < 0 || ratingValue > 5 || ratingCount === null) {
    return { ratingValue: null, ratingCount: null }
  }
  return { ratingValue, ratingCount }
}

const extractHeaderRating = (html: string): HeaderRating => {
  const $ = cheerio.load(html)
  const selectors = [".artist-card-extended__name", '[class*="artist-card-extended__name"]']
  for (const selector of selectors) {
    const node = $(selector).first()
    if (node.length === 0) {
      continue
    }
    const parsed = parseHeaderRating(node.text())
    if (parsed.ratingValue !== null && parsed.ratingCount !== null) {
      return parsed
    }
  }
  return { ratingValue: null, ratingCount: null }
}

export const parseLinkabandProfilePage = (html: string): ParsedProfilePage => {
  const parsed = parseGenericProfilePage(html, [
    "[data-testid='artist-description']",
    ".artist-description",
    ".description",
    "main",
  ])
  const headerRating = extractHeaderRating(html)
  return {
    ...parsed,
    ratingValue: headerRating.ratingValue ?? parsed.ratingValue,
    ratingCount: headerRating.ratingCount ?? parsed.ratingCount,
  }
}
