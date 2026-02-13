import * as cheerio from "cheerio"

import { type ParsedOutput, SCHEMA_VERSION, validateParsedOutput } from "../../schema/validate.js"
import { coerceFloat, coerceInt } from "../../utils/coerce.js"
import { buildResultItem, type ItemListEntry } from "./normalize.js"

const parseProfileIdFromUrl = (url: string): number | null => {
  const match = /\/profil-dj-(\d+)-/.exec(url)
  return match ? Number.parseInt(match[1] ?? "", 10) : null
}

const coerceArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) {
    return value
  }
  return value === null || value === undefined ? [] : [value]
}

const extractOffers = (
  value: unknown,
): { lowPrice: number | null; highPrice: number | null; priceCurrency: string | null } => {
  const offerCandidates = coerceArray(value).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object",
  )
  const offer = offerCandidates[0]
  if (!offer) {
    return { lowPrice: null, highPrice: null, priceCurrency: null }
  }
  return {
    lowPrice: coerceFloat(offer.lowPrice),
    highPrice: coerceFloat(offer.highPrice),
    priceCurrency: typeof offer.priceCurrency === "string" ? offer.priceCurrency : null,
  }
}

const normalizeItemListEntries = (itemListElement: unknown[]): ItemListEntry[] => {
  const out: ItemListEntry[] = []
  for (const li of itemListElement) {
    if (!li || typeof li !== "object") {
      continue
    }
    const itemObj = (li as Record<string, unknown>).item
    if (!itemObj || typeof itemObj !== "object") {
      continue
    }
    const item = itemObj as Record<string, unknown>
    const url = item.url
    if (typeof url !== "string" || !url) {
      continue
    }

    const image = item.image && typeof item.image === "object" ? (item.image as Record<string, unknown>) : {}
    const geo = item.geo && typeof item.geo === "object" ? (item.geo as Record<string, unknown>) : {}
    const address =
      item.address && typeof item.address === "object" ? (item.address as Record<string, unknown>) : {}
    const agg =
      item.aggregateRating && typeof item.aggregateRating === "object"
        ? (item.aggregateRating as Record<string, unknown>)
        : {}
    const offers = extractOffers(item.offers)

    const position = coerceInt((li as Record<string, unknown>).position)

    out.push({
      position,
      profile_id: parseProfileIdFromUrl(url),
      name: typeof item.name === "string" ? item.name : null,
      url,
      price_range: item.priceRange ?? null,
      offer_low_price: offers.lowPrice,
      offer_high_price: offers.highPrice,
      offer_currency: offers.priceCurrency,
      image_url: typeof image.url === "string" ? image.url : null,
      latitude: coerceFloat(geo.latitude),
      longitude: coerceFloat(geo.longitude),
      street_address: typeof address.streetAddress === "string" ? address.streetAddress : null,
      address_locality: typeof address.addressLocality === "string" ? address.addressLocality : null,
      postal_code: typeof address.postalCode === "string" ? address.postalCode : null,
      address_region: typeof address.addressRegion === "string" ? address.addressRegion : null,
      address_country: typeof address.addressCountry === "string" ? address.addressCountry : null,
      rating_count: coerceInt(agg.ratingCount),
      rating_value: coerceFloat(agg.ratingValue),
      worst_rating: coerceFloat(agg.worstRating),
      best_rating: coerceFloat(agg.bestRating),
      source: "jsonld",
      raw_item: item as Record<string, unknown>,
    })
  }
  return out
}

export const extractProfilesFromHtml = (html: string): ItemListEntry[] => {
  const $ = cheerio.load(html)

  const scripts = $('script[type="application/ld+json"]')
  for (const script of scripts.toArray()) {
    const scriptText = $(script).text().trim()
    if (!scriptText) {
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(scriptText)
    } catch {
      continue
    }
    for (const obj of coerceArray(parsed)) {
      if (!obj || typeof obj !== "object") {
        continue
      }
      const record = obj as Record<string, unknown>
      if (record["@type"] !== "ItemList" || !Array.isArray(record.itemListElement)) {
        continue
      }
      const normalized = normalizeItemListEntries(record.itemListElement)
      if (normalized.length > 0) {
        return normalized
      }
    }
  }

  const fallback: ItemListEntry[] = []
  const seen = new Set<string>()
  $('a[href*="/profil-dj-"]').each((_idx, el) => {
    const href = $(el).attr("href")
    if (!href) {
      return
    }
    const url = href.startsWith("http") ? href : `https://www.1001dj.com${href}`
    if (seen.has(url)) {
      return
    }
    seen.add(url)
    const name = $(el).text().trim()
    fallback.push({
      position: null,
      profile_id: parseProfileIdFromUrl(url),
      name: name || null,
      url,
      price_range: null,
      offer_low_price: null,
      offer_high_price: null,
      offer_currency: null,
      image_url: null,
      latitude: null,
      longitude: null,
      street_address: null,
      address_locality: null,
      postal_code: null,
      address_region: null,
      address_country: null,
      rating_count: null,
      rating_value: null,
      worst_rating: null,
      best_rating: null,
      source: "html",
      raw_item: null,
    })
  })
  return fallback
}

export const parseProfileList = (pages: string[]): ParsedOutput => {
  const entries: ItemListEntry[] = []
  const seen = new Set<string>()

  for (const html of pages) {
    const extracted = extractProfilesFromHtml(html)
    for (const entry of extracted) {
      if (seen.has(entry.url)) {
        continue
      }
      seen.add(entry.url)
      entries.push(entry)
    }
  }

  return validateParsedOutput({
    meta: {
      website: "1001dj",
      kind: entries.length > 0 ? "profiles" : "unknown",
      count: entries.length,
      numPages: pages.length,
      generatedAt: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
    },
    results: entries.map(buildResultItem),
    raw: null,
  })
}
