import * as cheerio from "cheerio"
import { z } from "zod"

import { coerceFloat, coerceInt } from "../../utils/coerce.js"
import { toRecordOrNull } from "../../utils/type-guards.js"

const jsonLdBlobSchema = z.union([
  z.record(z.string(), z.unknown()),
  z.array(z.record(z.string(), z.unknown())),
])

export interface RatingPerformance {
  coupDeCoeurPct: number | null
  parfaitPct: number | null
  ambianceDeFoliePct: number | null
  topTierPct: number | null
}

export interface ProfilePageDetails {
  description: string | null
  imageUrl: string | null
  ratingValue: number | null
  ratingCount: number | null
  ratingPerformance: RatingPerformance | null
  pricingMin: number | null
  pricingMax: number | null
  pricingCurrency: string | null
  pricesFound: number[]
}

const coerceArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) {
    return value
  }
  return value === null || value === undefined ? [] : [value]
}

const parseJsonLdBlobs = ($: cheerio.CheerioAPI): unknown[] => {
  const parsed: unknown[] = []
  const scripts = $('script[type="application/ld+json"]')
  for (const script of scripts.toArray()) {
    const text = $(script).text().trim()
    if (!text) {
      continue
    }
    try {
      const raw: unknown = JSON.parse(text)
      const validated = jsonLdBlobSchema.safeParse(raw)
      if (validated.success) {
        parsed.push(validated.data)
      }
    } catch {
      continue
    }
  }
  return parsed
}

interface OfferLike {
  lowPrice: number | null
  highPrice: number | null
  priceCurrency: string | null
}

const extractOfferLike = (value: unknown): OfferLike | null => {
  const queue: unknown[] = [value]
  while (queue.length > 0) {
    const current = queue.shift()
    const record = toRecordOrNull(current)
    if (!record) {
      continue
    }
    const lowPrice = coerceFloat(record.lowPrice)
    const highPrice = coerceFloat(record.highPrice)
    const priceCurrency = typeof record.priceCurrency === "string" ? record.priceCurrency : null
    if (lowPrice !== null || highPrice !== null || priceCurrency !== null) {
      return { lowPrice, highPrice, priceCurrency }
    }
    for (const nested of Object.values(record)) {
      if (nested && typeof nested === "object") {
        queue.push(nested)
      }
    }
  }
  return null
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

const extractDescription = ($: cheerio.CheerioAPI): string | null => {
  const block = $("div.description-truncate-lines p").first()
  if (block.length > 0) {
    const raw = block.text().replaceAll("\n", " ").replaceAll("\t", " ").replaceAll("\r", " ")
    const text = raw
      .split(" ")
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .join(" ")
    if (text.length > 0) {
      return text
    }
  }
  return getMetaContent($, "og:description") ?? getMetaContent($, "description")
}

const parseNumberToken = (token: string): number | null => {
  const cleaned = token
    .trim()
    .replaceAll("(", "")
    .replaceAll(")", "")
    .replaceAll(".", "")
    .replaceAll(",", ".")
  const value = Number.parseFloat(cleaned)
  return Number.isFinite(value) ? value : null
}

const extractRatingCount = ($: cheerio.CheerioAPI): number | null => {
  const explicitNodes = $(
    '[aria-label*="avis"], [aria-label*="évaluation"], [aria-label*="evaluation"]',
  )
  for (const node of explicitNodes.toArray()) {
    const ariaLabel = $(node).attr("aria-label")
    if (!ariaLabel) {
      continue
    }
    const chunks = ariaLabel.split(" ")
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]
      if (!chunk) {
        continue
      }
      const lower = chunk.toLowerCase()
      if (
        !lower.includes("avis") &&
        !lower.includes("evaluation") &&
        !lower.includes("évaluation")
      ) {
        continue
      }
      const prev = chunks[i - 1]
      if (!prev) {
        continue
      }
      const value = coerceInt(prev.replaceAll("(", "").replaceAll(")", ""))
      if (value !== null) {
        return value
      }
    }
  }

  const bodyTokens = $.root()
    .text()
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
  for (let i = 1; i < bodyTokens.length; i += 1) {
    const token = bodyTokens[i]?.toLowerCase() ?? ""
    if (
      token !== "avis" &&
      token !== "évaluations" &&
      token !== "evaluations" &&
      token !== "évaluation" &&
      token !== "evaluation"
    ) {
      continue
    }
    const prev = bodyTokens[i - 1]
    if (!prev) {
      continue
    }
    const value = coerceInt(prev.replaceAll("(", "").replaceAll(")", ""))
    if (value !== null) {
      return value
    }
  }
  return null
}

const normalizeKey = (value: string): string =>
  value
    .toLowerCase()
    .replaceAll("œ", "oe")
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .replaceAll(/[^a-z0-9 ]+/g, " ")
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" ")

const parsePercentToken = (token: string): number | null => {
  const cleaned = token.trim().replaceAll(",", ".")
  const lessThanMatch = /^-\s*de\s*([0-9]+(?:\.[0-9]+)?)$/i.exec(cleaned)
  if (lessThanMatch?.[1]) {
    const boundary = coerceFloat(lessThanMatch[1])
    return boundary === null ? null : boundary / 2
  }
  return coerceFloat(cleaned)
}

const round2 = (value: number): number => Math.round(value * 100) / 100

const extractRatingPerformance = ($: cheerio.CheerioAPI): RatingPerformance | null => {
  const block = $(".list-rating, [class*='list-rating']").first()
  if (block.length === 0) {
    return null
  }

  const text = block.text().replaceAll("\n", " ").replaceAll("\t", " ").replaceAll("\r", " ")
  const regex = /([A-Za-zÀ-ÿ0-9'’ -]+?)\s+((?:-\s*de\s*)?[0-9]+(?:[.,][0-9]+)?)\s*%/g
  const metrics = new Map<string, number>()
  for (const match of text.matchAll(regex)) {
    const labelRaw = match[1]
    const percentRaw = match[2]
    if (!labelRaw || !percentRaw) {
      continue
    }
    const percent = parsePercentToken(percentRaw)
    if (percent === null) {
      continue
    }
    metrics.set(normalizeKey(labelRaw), percent)
  }
  if (metrics.size === 0) {
    return null
  }

  const pick = (aliases: string[]): number | null => {
    for (const alias of aliases) {
      const key = normalizeKey(alias)
      const value = metrics.get(key)
      if (value !== undefined) {
        return value
      }
    }
    return null
  }

  const coupDeCoeurPct = pick(["Coup de coeur", "Coup de cœur"])
  const parfaitPct = pick(["Parfait"])
  const ambianceDeFoliePct = pick(["Ambiance de folie"])
  const topTierPctRaw = (coupDeCoeurPct ?? 0) + (parfaitPct ?? 0) + (ambianceDeFoliePct ?? 0)
  const topTierPct = topTierPctRaw > 0 ? round2(topTierPctRaw) : null

  return {
    coupDeCoeurPct,
    parfaitPct,
    ambianceDeFoliePct,
    topTierPct,
  }
}

const extractEuroPrices = ($: cheerio.CheerioAPI): number[] => {
  const prices: number[] = []
  const candidates = $(
    '.price-package, .fw-semibold, [class*="price"], [class*="Price"], [aria-label*="€"], [aria-label*="euro"]',
  )
  const texts = candidates.toArray().map((el) => $(el).text())
  if (texts.length === 0) {
    texts.push($.root().text())
  }

  for (const text of texts) {
    const tokens = text
      .replaceAll("\u00a0", " ")
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i]
      if (!token) {
        continue
      }
      const lower = token.toLowerCase()
      const marksEuro = lower.includes("€") || lower.includes("euro")
      if (marksEuro) {
        const prev = tokens[i - 1]
        if (prev) {
          const parsed = parseNumberToken(prev)
          if (parsed !== null) {
            prices.push(parsed)
          }
        }
        continue
      }
      if (i + 1 < tokens.length) {
        const next = tokens[i + 1]?.toLowerCase() ?? ""
        if (next.includes("€") || next.includes("euro")) {
          const parsed = parseNumberToken(token)
          if (parsed !== null) {
            prices.push(parsed)
          }
        }
      }
    }
  }
  return prices
}

export const parseProfilePage = (html: string): ProfilePageDetails => {
  const $ = cheerio.load(html)
  const jsonLd = parseJsonLdBlobs($)
  let offer: OfferLike | null = null
  for (const blob of jsonLd) {
    for (const obj of coerceArray(blob)) {
      const maybeOffer = extractOfferLike(obj)
      if (maybeOffer) {
        offer = maybeOffer
        break
      }
    }
    if (offer) {
      break
    }
  }

  const pricesFound = extractEuroPrices($)
  const fallbackMin = pricesFound.length > 0 ? Math.min(...pricesFound) : null
  const fallbackMax = pricesFound.length > 0 ? Math.max(...pricesFound) : null
  const ratingPerformance = extractRatingPerformance($)
  const ratingValue =
    ratingPerformance?.topTierPct !== null && ratingPerformance?.topTierPct !== undefined
      ? round2((ratingPerformance.topTierPct / 100) * 5)
      : null

  return {
    description: extractDescription($),
    imageUrl: getMetaContent($, "og:image"),
    ratingValue,
    ratingCount: extractRatingCount($),
    ratingPerformance,
    pricingMin: offer?.lowPrice ?? fallbackMin,
    pricingMax: offer?.highPrice ?? fallbackMax,
    pricingCurrency: offer?.priceCurrency ?? (pricesFound.length > 0 ? "EUR" : null),
    pricesFound,
  }
}
