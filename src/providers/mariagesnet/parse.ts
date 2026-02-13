import * as cheerio from "cheerio"

import { SCHEMA_VERSION, type ParsedOutput, validateParsedOutput } from "../../schema/validate.js"
import { buildResultItem, parseVendor } from "./normalize.js"

const parseDoubleEncodedJson = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value
  }
  try {
    const first = JSON.parse(value) as unknown
    if (typeof first === "string") {
      try {
        return JSON.parse(first) as unknown
      } catch {
        return first
      }
    }
    return first
  } catch {
    return value
  }
}

const parsePriceToFloat = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null
  }
  let text = String(value).trim()
  if (!text) {
    return null
  }
  text = text.replace(/\u00a0/g, " ").replace(/€/g, "").trim()
  text = text.replace(/[^0-9,.\- ]+/g, "").trim().replace(/ /g, "")
  if (text.includes(",") && text.includes(".")) {
    const lastComma = text.lastIndexOf(",")
    const lastDot = text.lastIndexOf(".")
    if (lastDot > lastComma) {
      text = text.replace(/,/g, "")
    } else {
      text = text.replace(/\./g, "").replace(",", ".")
    }
  } else if (text.includes(".")) {
    if (/^-?\d{1,3}(?:\.\d{3})+$/.test(text)) {
      text = text.replace(/\./g, "")
    }
  } else if (text.includes(",")) {
    if (/^-?\d{1,3}(?:,\d{3})+$/.test(text)) {
      text = text.replace(/,/g, "")
    } else {
      text = text.replace(",", ".")
    }
  }
  const parsed = Number.parseFloat(text)
  return Number.isFinite(parsed) ? parsed : null
}

const extractRatingAndReviews = (ariaLabel: string): { rating: number | null; reviews: number | null } => {
  const normalized = ariaLabel
    .replaceAll(",", ".")
    .replaceAll("\u00a0", " ")
    .replaceAll("(", " ")
    .replaceAll(")", " ")
    .replaceAll(":", " ")
    .replaceAll(";", " ")
  const tokens = normalized
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 0)

  let rating: number | null = null
  let reviews: number | null = null

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (!token) {
      continue
    }
    const lower = token.toLowerCase()
    if (lower === "sur" && i > 0 && i + 1 < tokens.length) {
      const prev = parsePriceToFloat(tokens[i - 1] ?? null)
      const next = parsePriceToFloat(tokens[i + 1] ?? null)
      if (prev !== null && next === 5) {
        rating = prev
      }
      continue
    }
    if (lower.startsWith("avis") && i > 0) {
      const count = Number.parseInt((tokens[i - 1] ?? "").replaceAll(".", ""), 10)
      if (!Number.isNaN(count)) {
        reviews = count
      }
    }
  }

  return { rating, reviews }
}

interface Tile {
  vendorId: string
  tileAttrs: Record<string, string>
  storefrontUrl: string | null
  name: string | null
  locationText: string | null
  description: string | null
  rating: number | null
  reviewsCount: number | null
  vendorInfo: Record<string, unknown> | null
}

const parseVendorTiles = (listingResultsHtml: unknown): Record<string, Tile> => {
  if (typeof listingResultsHtml !== "string" || !listingResultsHtml.length) {
    return {}
  }
  const $ = cheerio.load(listingResultsHtml)
  const out: Record<string, Tile> = {}

  $("li[data-vendor-id]").each((_idx, el) => {
    const vendorId = $(el).attr("data-vendor-id")?.trim()
    if (!vendorId) {
      return
    }

    const tileAttrs: Record<string, string> = {}
    for (const [key, value] of Object.entries(el.attribs ?? {})) {
      if (typeof value === "string") {
        tileAttrs[key] = value
      }
    }

    let rating: number | null = null
    let reviewsCount: number | null = null
    $(el)
      .find("[aria-label]")
      .each((_i, node) => {
        const label = $(node).attr("aria-label")
        if (!label) {
          return
        }
        const parsed = extractRatingAndReviews(label)
        if (parsed.rating !== null) {
          rating = parsed.rating
        }
        if (parsed.reviews !== null) {
          reviewsCount = parsed.reviews
        }
      })

    const storefront = $(el).find('a[data-test-id="storefrontTitle"]').first()
    const vendorInfoRaw = $(el).attr("data-vendor-info")
    let vendorInfo: Record<string, unknown> | null = null
    if (vendorInfoRaw) {
      try {
        const parsedInfo = JSON.parse(vendorInfoRaw) as unknown
        if (parsedInfo && typeof parsedInfo === "object" && !Array.isArray(parsedInfo)) {
          vendorInfo = parsedInfo as Record<string, unknown>
        }
      } catch {
        vendorInfo = null
      }
    }

    out[vendorId] = {
      vendorId,
      tileAttrs,
      storefrontUrl: storefront.attr("href") ?? null,
      name: storefront.text().trim() || null,
      locationText: $(el).find(".vendorTile__location").first().text().trim() || null,
      description: $(el).find("p.vendorTile__description").first().text().trim() || null,
      rating,
      reviewsCount,
      vendorInfo,
    }
  })

  return out
}

const groupMarkersById = (mapMarkers: unknown): Record<string, Record<string, unknown>> => {
  const decoded = parseDoubleEncodedJson(mapMarkers)
  if (!Array.isArray(decoded)) {
    return {}
  }
  const groups: Record<string, Record<string, unknown>> = {}
  for (const item of decoded) {
    if (!item || typeof item !== "object") {
      continue
    }
    const record = item as Record<string, unknown>
    const vendorId = record.vendorId
    if (typeof vendorId === "string" && vendorId.length > 0) {
      groups[vendorId] = record
    }
  }
  return groups
}

const groupGalleryById = (gallery: unknown): Record<string, Record<string, unknown>[]> => {
  if (!gallery || typeof gallery !== "object" || Array.isArray(gallery)) {
    return {}
  }
  const groups: Record<string, Record<string, unknown>[]> = {}
  for (const [vendorId, rawItems] of Object.entries(gallery as Record<string, unknown>)) {
    if (!Array.isArray(rawItems)) {
      continue
    }
    groups[vendorId] = rawItems.filter(
      (item): item is Record<string, unknown> => Boolean(item) && typeof item === "object",
    )
  }
  return groups
}

const extractVendors = (obj: Record<string, unknown>): Record<string, unknown>[] => {
  const tilesById = parseVendorTiles(obj.listingResults)
  const markersById = groupMarkersById(obj.mapMarkers)
  const galleryById = groupGalleryById(obj.listingVendorsGalleryJson)

  const orderedVendorIdsRaw = Array.isArray(obj.resultVendorsIds) ? obj.resultVendorsIds : []
  const orderedVendorIds = orderedVendorIdsRaw
    .map((id) => (id === null || id === undefined ? null : String(id)))
    .filter((id): id is string => Boolean(id))

  const vendorIds = orderedVendorIds.length > 0 ? orderedVendorIds : Object.keys(tilesById)
  const vendors: Record<string, unknown>[] = []

  for (const vendorId of vendorIds) {
    const tile = tilesById[vendorId]
    const marker = markersById[vendorId]
    const gallery = galleryById[vendorId]

    const record: Record<string, unknown> = { vendorId }
    if (tile) {
      record.name = tile.name
      record.storefrontUrl = tile.storefrontUrl
      record.locationText = tile.locationText
      record.description = tile.description
      record.rating = tile.rating
      record.reviewsCount = tile.reviewsCount
      record.tileAttrs = tile.tileAttrs
      record.vendorInfo = tile.vendorInfo
    }
    if (marker) {
      record.mapMarker = marker
      if ((record.rating === null || record.rating === undefined) && marker.averageRating !== undefined) {
        record.rating = parsePriceToFloat(marker.averageRating)
      }
    }
    if (gallery) {
      record.gallery = gallery
    }

    const vendorInfo =
      record.vendorInfo && typeof record.vendorInfo === "object"
        ? (record.vendorInfo as Record<string, unknown>)
        : null
    if (vendorInfo) {
      record.startingPrice = vendorInfo.price ?? null
      record.startingPriceValue = parsePriceToFloat(vendorInfo.price ?? null)
      record.currency = typeof vendorInfo.currency === "string" ? vendorInfo.currency : null
      record.sector = typeof vendorInfo.sector === "string" ? vendorInfo.sector : null
      record.address =
        vendorInfo.address && typeof vendorInfo.address === "object"
          ? (vendorInfo.address as Record<string, unknown>)
          : {}
    }
    vendors.push(record)
  }

  return vendors
}

const dataToResponses = (data: unknown): Record<string, unknown>[] => {
  if (Array.isArray(data)) {
    return data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
  }
  if (!data || typeof data !== "object") {
    throw new Error("Unsupported JSON shape for Mariages.net parser")
  }
  const record = data as Record<string, unknown>

  const maybeLog = record.log
  if (maybeLog && typeof maybeLog === "object") {
    const entries = (maybeLog as Record<string, unknown>).entries
    if (Array.isArray(entries)) {
      const responses: Record<string, unknown>[] = []
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") {
          continue
        }
        const req = (entry as Record<string, unknown>).request
        const res = (entry as Record<string, unknown>).response
        if (!req || typeof req !== "object" || !res || typeof res !== "object") {
          continue
        }
        const url = (req as Record<string, unknown>).url
        if (typeof url !== "string" || !url.includes("search-filters.php")) {
          continue
        }
        const content = (res as Record<string, unknown>).content
        const text = content && typeof content === "object" ? (content as Record<string, unknown>).text : null
        if (typeof text !== "string" || !text.trim()) {
          continue
        }
        try {
          const parsed = JSON.parse(text) as unknown
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            responses.push(parsed as Record<string, unknown>)
          }
        } catch {
          continue
        }
      }
      if (responses.length > 0) {
        return responses
      }
      throw new Error("HAR detected but no Mariages.net search-filters response found")
    }
  }
  return [record]
}

export const parseMariagesnet = (data: unknown): ParsedOutput => {
  const responses = dataToResponses(data)
  const seen = new Set<string>()
  const vendorsAll: Record<string, unknown>[] = []

  for (const response of responses) {
    for (const vendor of extractVendors(response)) {
      const vendorId = vendor.vendorId
      if (typeof vendorId === "string" && seen.has(vendorId)) {
        continue
      }
      if (typeof vendorId === "string") {
        seen.add(vendorId)
      }
      vendorsAll.push(vendor)
    }
  }

  const parsedVendors = vendorsAll.flatMap((vendor) => {
    try {
      return [parseVendor(vendor)]
    } catch {
      return []
    }
  })

  return validateParsedOutput({
    meta: {
      website: "mariagesnet",
      kind: "profiles",
      count: parsedVendors.length,
      numResponses: responses.length,
      numVendors: vendorsAll.length,
      generatedAt: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
    },
    results: parsedVendors.map(buildResultItem),
    raw: null,
  })
}
