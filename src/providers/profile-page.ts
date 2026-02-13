import * as cheerio from "cheerio"

import { coerceFloat, coerceInt } from "../utils/coerce.js"

export interface ParsedProfilePage {
  description: string | null
  imageUrl: string | null
  ratingValue: number | null
  ratingCount: number | null
  pricingMin: number | null
  pricingMax: number | null
  pricingCurrency: string | null
  pricesFound: number[]
}

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

const tokenToNumber = (token: string): number | null => {
  const cleaned = token
    .replaceAll("(", "")
    .replaceAll(")", "")
    .replaceAll("[", "")
    .replaceAll("]", "")
    .replaceAll("€", "")
    .replaceAll("euros", "")
    .replaceAll("euro", "")
    .replaceAll(",", ".")
    .replaceAll(" ", "")
    .trim()
  if (!cleaned) {
    return null
  }
  return coerceFloat(cleaned)
}

const getMetaContent = ($: cheerio.CheerioAPI, name: string): string | null => {
  const byName = $(`meta[name="${name}"]`).attr("content")
  if (typeof byName === "string" && byName.trim().length > 0) {
    return byName.trim()
  }
  const byProperty = $(`meta[property="${name}"]`).attr("content")
  if (typeof byProperty === "string" && byProperty.trim().length > 0) {
    return byProperty.trim()
  }
  return null
}

const extractDescription = ($: cheerio.CheerioAPI, selectors: string[]): string | null => {
  for (const selector of selectors) {
    const node = $(selector).first()
    if (node.length === 0) {
      continue
    }
    const text = normalizeSpaces(node.text())
    if (text.length > 0) {
      return text
    }
  }
  return getMetaContent($, "og:description") ?? getMetaContent($, "description")
}

const extractRatingCount = ($: cheerio.CheerioAPI): number | null => {
  const parseCountToken = (token: string): number | null => {
    const digits = token.replaceAll(".", "").replaceAll(",", "").replace(/[^0-9]/g, "")
    if (!digits) {
      return null
    }
    return coerceInt(digits)
  }

  const text = normalizeSpaces($.root().text())
  const tokens = text.split(" ").filter((token) => token.length > 0)
  const ratingWords = new Set(["avis", "review", "reviews", "evaluation", "evaluations", "évaluation", "évaluations"])
  const normalizeRatingWord = (token: string): string =>
    token
      .toLowerCase()
      .replace(/[^a-z\u00e0-\u00ff]/g, "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")

  for (let i = 1; i < tokens.length; i += 1) {
    const token = normalizeRatingWord(tokens[i] ?? "")
    if (!ratingWords.has(token)) {
      continue
    }
    const candidate = tokens[i - 1] ?? ""
    const value = parseCountToken(candidate)
    if (value !== null) {
      return value
    }
    const nextCandidate = tokens[i + 1] ?? ""
    const nextValue = parseCountToken(nextCandidate)
    if (nextValue !== null) {
      return nextValue
    }
  }
  return null
}

const extractRatingValueFromText = (text: string): number | null => {
  const normalized = normalizeSpaces(text).replaceAll(",", ".")
  if (!normalized) {
    return null
  }

  const slashMatch = /([0-9]+(?:\.[0-9]+)?)\s*\/\s*5\b/i.exec(normalized)
  if (slashMatch?.[1]) {
    const slashValue = coerceFloat(slashMatch[1])
    if (slashValue !== null && slashValue >= 0 && slashValue <= 5) {
      return slashValue
    }
  }

  const tokens = normalized
    .replaceAll("/", " / ")
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 0)

  for (let i = 1; i + 1 < tokens.length; i += 1) {
    const token = tokens[i]?.toLowerCase()
    if (token !== "sur" && token !== "/") {
      continue
    }
    const prev = coerceFloat(tokens[i - 1] ?? "")
    const next = coerceFloat(tokens[i + 1] ?? "")
    if (prev !== null && next === 5 && prev >= 0 && prev <= 5) {
      return prev
    }
  }

  return null
}

const extractRatingValue = ($: cheerio.CheerioAPI): number | null => {
  const explicitNodes = $(
    [
      '[data-testid="storefrontHeadingReviewsStars"]',
      '[data-testid*="Reviews"][data-testid*="Stars"]',
      '[data-testid*="reviews"][data-testid*="stars"]',
      ".storefrontHeadingReviews__stars",
      '[aria-label*="Note globale"]',
      '[aria-label*="note globale"]',
      '[aria-label*="sur 5"]',
    ].join(", "),
  )

  for (const node of explicitNodes.toArray()) {
    const ariaLabel = $(node).attr("aria-label")
    if (ariaLabel) {
      const fromAria = extractRatingValueFromText(ariaLabel)
      if (fromAria !== null) {
        return fromAria
      }
    }
    const nodeText = normalizeSpaces($(node).text())
    if (nodeText) {
      const fromText = extractRatingValueFromText(nodeText)
      if (fromText !== null) {
        return fromText
      }
    }
  }

  return extractRatingValueFromText(normalizeSpaces($.root().text()))
}

const extractPrices = ($: cheerio.CheerioAPI): number[] => {
  const texts: string[] = []
  const candidates = $('[class*="price"], [class*="Price"], [data-test*="price"], [aria-label*="€"], [aria-label*="euro"]')
  for (const node of candidates.toArray()) {
    const text = normalizeSpaces($(node).text())
    if (text.length > 0) {
      texts.push(text)
    }
  }
  if (texts.length === 0) {
    texts.push(normalizeSpaces($.root().text()))
  }

  const prices: number[] = []
  for (const text of texts) {
    const tokens = text.split(" ").filter((token) => token.length > 0)
    for (let i = 0; i < tokens.length; i += 1) {
      const token = (tokens[i] ?? "").toLowerCase()
      const prev = tokens[i - 1] ?? ""
      const next = tokens[i + 1] ?? ""
      if (token.includes("€") || token.includes("euro")) {
        const numberParts: string[] = []
        let back = i - 1
        while (back >= 0) {
          const candidate = tokens[back] ?? ""
          const parsed = tokenToNumber(candidate)
          if (parsed === null) {
            break
          }
          numberParts.unshift(candidate)
          back -= 1
        }
        if (numberParts.length > 0) {
          const merged = numberParts.join("")
          const parsedMerged = tokenToNumber(merged)
          if (parsedMerged !== null) {
            prices.push(parsedMerged)
          }
        } else {
          const parsedPrev = tokenToNumber(prev)
          if (parsedPrev !== null) {
            prices.push(parsedPrev)
          }
        }
        const parsedSelf = tokenToNumber(tokens[i] ?? "")
        if (parsedSelf !== null) {
          prices.push(parsedSelf)
        }
        continue
      }
      if (next.toLowerCase().includes("€") || next.toLowerCase().includes("euro")) {
        const numberParts: string[] = []
        let back = i
        while (back >= 0) {
          const candidate = tokens[back] ?? ""
          const parsed = tokenToNumber(candidate)
          if (parsed === null) {
            break
          }
          numberParts.unshift(candidate)
          back -= 1
        }
        if (numberParts.length > 0) {
          const merged = numberParts.join("")
          const parsedMerged = tokenToNumber(merged)
          if (parsedMerged !== null) {
            prices.push(parsedMerged)
          }
        }
      }
    }
  }
  return prices
}

export const parseGenericProfilePage = (html: string, descriptionSelectors: string[]): ParsedProfilePage => {
  const $ = cheerio.load(html)
  const pricesFound = extractPrices($)
  return {
    description: extractDescription($, descriptionSelectors),
    imageUrl: getMetaContent($, "og:image"),
    ratingValue: extractRatingValue($),
    ratingCount: extractRatingCount($),
    pricingMin: pricesFound.length > 0 ? Math.min(...pricesFound) : null,
    pricingMax: pricesFound.length > 0 ? Math.max(...pricesFound) : null,
    pricingCurrency: pricesFound.length > 0 ? "EUR" : null,
    pricesFound,
  }
}
