import { makeLocation, makeMedia, makeNormalizedResult, makePricing, makeRatings, makeSource, type ResultItem } from "../../schema/normalized.js"
import { coerceFloat, coerceInt } from "../../utils/coerce.js"

export interface VendorProfile {
  vendor_id: string
  name: string | null
  storefront_url: string | null
  location_text: string | null
  description: string | null
  rating: number | null
  reviews_count: number | null
  tile_attrs: Record<string, unknown>
  vendor_info: Record<string, unknown>
  map_marker: Record<string, unknown>
  gallery: Record<string, unknown>[]
  starting_price: unknown
  starting_price_value: number | null
  currency: string | null
  sector: string | null
  address: Record<string, unknown>
  raw: Record<string, unknown>
}

export const parseVendor = (raw: Record<string, unknown>): VendorProfile => {
  const vendorId = raw.vendorId
  if (typeof vendorId !== "string" || !vendorId) {
    throw new Error("vendorId missing or invalid")
  }
  return {
    vendor_id: vendorId,
    name: typeof raw.name === "string" ? raw.name : null,
    storefront_url: typeof raw.storefrontUrl === "string" ? raw.storefrontUrl : null,
    location_text: typeof raw.locationText === "string" ? raw.locationText : null,
    description: typeof raw.description === "string" ? raw.description : null,
    rating: coerceFloat(raw.rating),
    reviews_count: coerceInt(raw.reviewsCount),
    tile_attrs: raw.tileAttrs && typeof raw.tileAttrs === "object" ? (raw.tileAttrs as Record<string, unknown>) : {},
    vendor_info:
      raw.vendorInfo && typeof raw.vendorInfo === "object" ? (raw.vendorInfo as Record<string, unknown>) : {},
    map_marker:
      raw.mapMarker && typeof raw.mapMarker === "object" ? (raw.mapMarker as Record<string, unknown>) : {},
    gallery: Array.isArray(raw.gallery)
      ? raw.gallery.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      : [],
    starting_price: raw.startingPrice ?? null,
    starting_price_value: coerceFloat(raw.startingPriceValue),
    currency: typeof raw.currency === "string" ? raw.currency : null,
    sector: typeof raw.sector === "string" ? raw.sector : null,
    address: raw.address && typeof raw.address === "object" ? (raw.address as Record<string, unknown>) : {},
    raw,
  }
}

const galleryUrls = (gallery: Record<string, unknown>[]): string[] => {
  const urls: string[] = []
  for (const item of gallery) {
    for (const [key, value] of Object.entries(item)) {
      if (key.startsWith("src") && typeof value === "string" && value.length > 0) {
        urls.push(value)
      }
    }
  }
  return urls
}

const pickImage = (gallery: Record<string, unknown>[]): string | null => {
  for (const item of gallery) {
    for (const key of ["srcWebp640", "srcWebp320", "srcJpeg640", "srcJpeg320"]) {
      const value = item[key]
      if (typeof value === "string" && value.length > 0) {
        return value
      }
    }
  }
  const urls = galleryUrls(gallery)
  return urls[0] ?? null
}

export const normalizeVendor = (vendor: VendorProfile) => {
  let locationText = vendor.location_text
  if (!locationText) {
    const parts = [vendor.address.city, vendor.address.region, vendor.address.country]
      .filter((value): value is string => typeof value === "string")
      .filter(Boolean)
    if (parts.length > 0) {
      locationText = parts.join(", ")
    }
  }

  const flagsObj: Record<string, unknown> = {}
  for (const key of [
    "isNewFlagETM",
    "isQuickResponseEnabled",
    "isSpotLight",
    "isExtraFilled",
    "isDragAndSearchItem",
  ]) {
    if (key in vendor.map_marker) {
      flagsObj[key] = vendor.map_marker[key]
    }
  }
  const flags = Object.keys(flagsObj).length > 0 ? flagsObj : null

  const metricsObj: Record<string, unknown> = {}
  const position = coerceInt(vendor.tile_attrs["data-it-position"])
  const overallPosition = coerceInt(vendor.tile_attrs["data-overall-position"])
  if (position !== null) metricsObj.position = position
  if (overallPosition !== null) metricsObj.overall_position = overallPosition
  const metrics = Object.keys(metricsObj).length > 0 ? metricsObj : null

  const imageUrl = pickImage(vendor.gallery)
  const galleries = galleryUrls(vendor.gallery)
  const avgRating = coerceFloat(vendor.map_marker.averageRating)

  return makeNormalizedResult({
    website: "mariagesnet",
    kind: "profile",
    sourceId: vendor.vendor_id,
    name: vendor.name,
    url: vendor.storefront_url,
    description: vendor.description,
    location: makeLocation({
      text: locationText,
      street_address: typeof vendor.address.addr1 === "string" ? vendor.address.addr1 : null,
      city: typeof vendor.address.city === "string" ? vendor.address.city : null,
      postcode: typeof vendor.address.postal_code === "string" ? vendor.address.postal_code : null,
      region: typeof vendor.address.region === "string" ? vendor.address.region : null,
      country: typeof vendor.address.country === "string" ? vendor.address.country : null,
      latitude: coerceFloat(vendor.map_marker.lat),
      longitude: coerceFloat(vendor.map_marker.lng),
    }),
    ratings: makeRatings({
      value: vendor.rating,
      count: vendor.reviews_count,
      average: avgRating,
    }),
    pricing: makePricing({
      min: vendor.starting_price_value,
      raw: vendor.starting_price,
      currency: vendor.currency,
    }),
    categories: vendor.sector ? [vendor.sector] : null,
    tags: null,
    media: makeMedia({
      image_url: imageUrl,
      gallery_urls: galleries.length > 0 ? galleries : null,
    }),
    source: makeSource({
      url: vendor.storefront_url,
      position,
      origin: "search-filters",
    }),
    flags,
    metrics,
    attributes: {
      tile_attrs: Object.keys(vendor.tile_attrs).length > 0 ? vendor.tile_attrs : null,
      vendor_info: Object.keys(vendor.vendor_info).length > 0 ? vendor.vendor_info : null,
      map_marker: Object.keys(vendor.map_marker).length > 0 ? vendor.map_marker : null,
    },
  })
}

export const buildResultItem = (vendor: VendorProfile): ResultItem => ({
  kind: "profile",
  normalized: normalizeVendor(vendor),
  raw: vendor.raw,
})
