import * as cheerio from "cheerio"
import { z } from "zod"

import { type ParsedOutput, SCHEMA_VERSION, validateParsedOutput } from "../../schema/validate.js"
import { coerceFloat, coerceInt } from "../../utils/coerce.js"
import { toRecordOrEmpty, toRecordOrNull } from "../../utils/type-guards.js"
import { buildResultItem, type ItemListEntry } from "./normalize.js"

const itemListLdSchema = z
  .object({
    "@type": z.literal("ItemList"),
    itemListElement: z.array(z.record(z.string(), z.unknown())),
  })
  .loose()

const parseProfileIdFromUrl = (url: string): number | null => {
  const match = /\/profil-dj-(\d+)-/.exec(url)
  return match ? Number.parseInt(match[1], 10) : null
}

const coerceArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) {
    return value
  }
  return value === null || value === undefined ? [] : [value]
}

interface ParsedOfferPriceRange {
  lowPrice: number | null
  highPrice: number | null
  priceCurrency: string | null
}

const extractOffers = (value: unknown): ParsedOfferPriceRange => {
  const offerCandidate = coerceArray(value).find(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object",
  )
  const offer = offerCandidate
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
    const liRecord = toRecordOrNull(li)
    if (!liRecord) {
      continue
    }
    const item = toRecordOrNull(liRecord.item)
    if (!item) {
      continue
    }
    const url = item.url
    if (typeof url !== "string" || !url) {
      continue
    }

    const image = toRecordOrEmpty(item.image)
    const geo = toRecordOrEmpty(item.geo)
    const address = toRecordOrEmpty(item.address)
    const agg = toRecordOrEmpty(item.aggregateRating)
    const offers = extractOffers(item.offers)

    const position = coerceInt(liRecord.position)

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
      address_locality:
        typeof address.addressLocality === "string" ? address.addressLocality : null,
      postal_code: typeof address.postalCode === "string" ? address.postalCode : null,
      address_region: typeof address.addressRegion === "string" ? address.addressRegion : null,
      address_country: typeof address.addressCountry === "string" ? address.addressCountry : null,
      rating_count: coerceInt(agg.ratingCount),
      rating_value: coerceFloat(agg.ratingValue),
      worst_rating: coerceFloat(agg.worstRating),
      best_rating: coerceFloat(agg.bestRating),
      source: "jsonld",
      raw_item: item,
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
      const itemListParsed = itemListLdSchema.safeParse(obj)
      if (!itemListParsed.success) {
        continue
      }
      const normalized = normalizeItemListEntries(itemListParsed.data.itemListElement)
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

export const parseListingPages = (pages: string[]): ItemListEntry[] => {
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

  return entries
}

export const parseProfileList = (pages: string[]): ParsedOutput => {
  const entries = parseListingPages(pages)

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
    raw: {
      listingPagesHtml: pages,
    },
  })
}
