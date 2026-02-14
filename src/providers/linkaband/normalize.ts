import {
  makeLocation,
  makeMedia,
  makeNormalizedResult,
  makePricing,
  makeRatings,
  makeSource,
  type ResultItem,
} from "../../schema/normalized.js"
import { coerceFloat, coerceInt } from "../../utils/coerce.js"
import { toRecordOrNull } from "../../utils/type-guards.js"

interface ImageRef {
  url: string | null
  original: string | null
  url_bis: string | null
}

interface LowestService {
  amount_one_brut: number | null
  amount_full_ht: number | null
  amount_full_ttc: number | null
  duration: string | null
}

interface LowestLineup {
  name: string | null
  description: string | null
  nb_membres: number | null
  material: string | null
  lowest_prestation: LowestService | null
}

interface ArtistLocation {
  city: string | null
  zipcode: string | null
  country: string | null
}

export interface ArtistProfile {
  profile_id: number
  name: string
  slug: string
  departement_name: string | null
  departement_zipcode: string | null
  verified: boolean | null
  global_rating: number | null
  avg_rating: number | null
  nb_comments: number | null
  nb_membres: number | null
  response_time: string | null
  profile_type: string | null
  artiste_type: string | null
  super_artiste_type: string | null
  need_onboarding: boolean | null
  outdated_availabilities: boolean | null
  artiste_type_changed: boolean | null
  index_flag: boolean | null
  last_update: string | null
  unavailabilities_count: number | null
  formations_count: number | null
  albums_count: number | null
  abonnements_count: number | null
  profile_picture: ImageRef
  cover_pictures: ImageRef[]
  localisation: ArtistLocation
  lowest_formation: LowestLineup | null
  styles: string[]
  players: string[]
  description: string | null
  facturation: string | null
  raw: Record<string, unknown>
}

const imageFromObj = (obj: unknown): ImageRef => {
  const record = toRecordOrNull(obj)
  if (!record) {
    return { url: null, original: null, url_bis: null }
  }
  return {
    url: typeof record.url === "string" ? record.url : null,
    original: typeof record.original === "string" ? record.original : null,
    url_bis: typeof record.url_bis === "string" ? record.url_bis : null,
  }
}

const lowestServiceFromObj = (obj: unknown): LowestService | null => {
  const record = toRecordOrNull(obj)
  if (!record) {
    return null
  }
  return {
    amount_one_brut: coerceFloat(record.amount_one_brut),
    amount_full_ht: coerceFloat(record.amount_full_ht),
    amount_full_ttc: coerceFloat(record.amount_full_ttc),
    duration: typeof record.duree === "string" ? record.duree : null,
  }
}

const lowestLineupFromObj = (obj: unknown): LowestLineup | null => {
  const record = toRecordOrNull(obj)
  if (!record) {
    return null
  }
  return {
    name: typeof record.name === "string" ? record.name : null,
    description: typeof record.description === "string" ? record.description : null,
    nb_membres: coerceInt(record.nb_membres),
    material: typeof record.material === "string" ? record.material : null,
    lowest_prestation: lowestServiceFromObj(record.lowest_prestation),
  }
}

const artistLocationFromObj = (obj: unknown): ArtistLocation => {
  const record = toRecordOrNull(obj)
  if (!record) {
    return { city: null, zipcode: null, country: null }
  }
  return {
    city: typeof record.city === "string" ? record.city : null,
    zipcode: typeof record.zipcode === "string" ? record.zipcode : null,
    country: typeof record.country === "string" ? record.country : null,
  }
}

const coverPicturesFromObj = (obj: unknown): ImageRef[] => {
  if (Array.isArray(obj)) {
    return obj.map((item) => imageFromObj(item))
  }
  if (obj && typeof obj === "object") {
    return [imageFromObj(obj)]
  }
  return []
}

export const parseArtist = (raw: Record<string, unknown>): ArtistProfile => {
  const profileId = raw.id
  const name = raw.name
  const slug = raw.slug
  if (
    typeof profileId !== "number" ||
    !Number.isInteger(profileId) ||
    typeof name !== "string" ||
    typeof slug !== "string"
  ) {
    throw new Error("Artist id/name/slug missing")
  }

  const styles = Array.isArray(raw.styles)
    ? raw.styles.filter((s): s is string => typeof s === "string")
    : []
  const players = Array.isArray(raw.players)
    ? raw.players.filter((s): s is string => typeof s === "string")
    : []
  const unavailabilities = Array.isArray(raw.unavailabilities) ? raw.unavailabilities : null
  const formations = Array.isArray(raw.formations) ? raw.formations : null
  const albums = Array.isArray(raw.albums) ? raw.albums : null
  const abonnements = Array.isArray(raw.abonnements) ? raw.abonnements : null

  return {
    profile_id: profileId,
    name,
    slug,
    departement_name: typeof raw.departement_name === "string" ? raw.departement_name : null,
    departement_zipcode:
      typeof raw.departement_zipcode === "string" ? raw.departement_zipcode : null,
    verified: typeof raw.verified === "boolean" ? raw.verified : null,
    global_rating: coerceFloat(raw.global_rating),
    avg_rating: coerceFloat(raw.avg_rating),
    nb_comments: coerceInt(raw.nb_comments),
    nb_membres: coerceInt(raw.nb_membres),
    response_time: typeof raw.response_time === "string" ? raw.response_time : null,
    profile_type: typeof raw.type === "string" ? raw.type : null,
    artiste_type: typeof raw.artiste_type === "string" ? raw.artiste_type : null,
    super_artiste_type: typeof raw.super_artiste_type === "string" ? raw.super_artiste_type : null,
    need_onboarding: typeof raw.need_onboarding === "boolean" ? raw.need_onboarding : null,
    outdated_availabilities:
      typeof raw.outdated_availabilities === "boolean" ? raw.outdated_availabilities : null,
    artiste_type_changed:
      typeof raw.artiste_type_changed === "boolean" ? raw.artiste_type_changed : null,
    index_flag: typeof raw.index === "boolean" ? raw.index : null,
    last_update: typeof raw.last_update === "string" ? raw.last_update : null,
    unavailabilities_count: unavailabilities?.length ?? null,
    formations_count: formations?.length ?? null,
    albums_count: albums?.length ?? null,
    abonnements_count: abonnements?.length ?? null,
    profile_picture: imageFromObj(raw.profile_picture),
    cover_pictures: coverPicturesFromObj(raw.cover_picture ?? raw.cover_pictures),
    localisation: artistLocationFromObj(raw.localisation),
    lowest_formation: lowestLineupFromObj(raw.lowest_formation),
    styles,
    players,
    description: typeof raw.description === "string" ? raw.description : null,
    facturation: typeof raw.facturation === "string" ? raw.facturation : null,
    raw,
  }
}

const primaryPrice = (lowest: LowestService | null): number | null =>
  lowest?.amount_full_ttc ?? lowest?.amount_one_brut ?? lowest?.amount_full_ht ?? null

const coverUrls = (covers: ImageRef[]): string[] => {
  const urls: string[] = []
  for (const cover of covers) {
    for (const url of [cover.url, cover.original, cover.url_bis]) {
      if (url) {
        urls.push(url)
      }
    }
  }
  return urls
}

export const buildProfile = (artist: ArtistProfile) => {
  const locationText =
    [artist.localisation.city, artist.localisation.country]
      .filter((v): v is string => Boolean(v))
      .join(", ") || null
  const lowest = artist.lowest_formation?.lowest_prestation ?? null
  const rawPrice =
    lowest === null
      ? null
      : {
          amount_one_brut: lowest.amount_one_brut,
          amount_full_ht: lowest.amount_full_ht,
          amount_full_ttc: lowest.amount_full_ttc,
          duration: lowest.duration,
        }

  return makeNormalizedResult({
    website: "linkaband",
    kind: "profile",
    sourceId: artist.profile_id,
    name: artist.name,
    slug: artist.slug,
    description: artist.description,
    location: makeLocation({
      text: locationText,
      city: artist.localisation.city,
      postcode: artist.localisation.zipcode,
      region: artist.departement_name,
      country: artist.localisation.country,
    }),
    ratings: makeRatings({
      value: artist.global_rating,
      count: artist.nb_comments,
      average: artist.avg_rating,
    }),
    pricing: makePricing({
      min: primaryPrice(lowest),
      max: null,
      raw: rawPrice,
      currency: null,
    }),
    categories: artist.styles.length ? artist.styles : null,
    tags: artist.players.length ? artist.players : null,
    media: makeMedia({
      image_url:
        artist.profile_picture.url ??
        artist.profile_picture.original ??
        artist.profile_picture.url_bis,
      cover_urls: coverUrls(artist.cover_pictures),
    }),
    source: makeSource({
      slug: artist.slug,
      origin: "api",
    }),
    flags: {
      verified: artist.verified,
      need_onboarding: artist.need_onboarding,
      outdated_availabilities: artist.outdated_availabilities,
      artiste_type_changed: artist.artiste_type_changed,
      index: artist.index_flag,
    },
    metrics: {
      members_count: artist.nb_membres,
      response_time: artist.response_time,
      unavailabilities_count: artist.unavailabilities_count,
      formations_count: artist.formations_count,
      albums_count: artist.albums_count,
      abonnements_count: artist.abonnements_count,
    },
    attributes: {
      departement_zipcode: artist.departement_zipcode,
      profile_type: artist.profile_type,
      artiste_type: artist.artiste_type,
      super_artiste_type: artist.super_artiste_type,
      facturation: artist.facturation,
      last_update: artist.last_update,
      lowest_formation: artist.lowest_formation
        ? {
            name: artist.lowest_formation.name,
            description: artist.lowest_formation.description,
            nb_membres: artist.lowest_formation.nb_membres,
            material: artist.lowest_formation.material,
          }
        : null,
    },
  })
}

export const buildResultItem = (artist: ArtistProfile): ResultItem => ({
  kind: "profile",
  normalized: buildProfile(artist),
  raw: artist.raw,
})
