import { z } from "zod"

export const jsonValueSchema: z.ZodType = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
)

export const locationSchema = z
  .object({
    text: z.string().nullable(),
    street_address: z.string().nullable(),
    city: z.string().nullable(),
    postcode: z.string().nullable(),
    region: z.string().nullable(),
    country: z.string().nullable(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
  })
  .loose()

export const ratingsSchema = z
  .object({
    value: z.number().nullable(),
    count: z.number().int().nullable(),
    best: z.number().nullable(),
    worst: z.number().nullable(),
    average: z.number().nullable(),
  })
  .loose()

export const pricingSchema = z
  .object({
    min: z.number().nullable(),
    max: z.number().nullable(),
    raw: jsonValueSchema.nullable(),
    currency: z.string().nullable(),
  })
  .loose()

export const mediaSchema = z
  .object({
    image_url: z.string().nullable(),
    cover_urls: z.array(z.string()).nullable(),
    gallery_urls: z.array(z.string()).nullable(),
    video_urls: z.array(z.string()).nullable(),
  })
  .loose()

export const sourceSchema = z
  .object({
    url: z.string().nullable(),
    slug: z.string().nullable(),
    position: z.number().int().nullable(),
    index: z.string().nullable(),
    origin: z.string().nullable(),
  })
  .loose()

export const normalizedProfileSchema = z
  .object({
    website: z.string().min(1),
    kind: z.enum(["profile", "aggregation"]),
    id: z.unknown(),
    name: z.string().nullable(),
    url: z.string().nullable(),
    slug: z.string().nullable(),
    description: z.string().nullable(),
    location: locationSchema,
    ratings: ratingsSchema,
    pricing: pricingSchema,
    categories: z.array(z.unknown()).nullable(),
    tags: z.array(z.unknown()).nullable(),
    media: mediaSchema,
    source: sourceSchema,
    flags: z.record(z.string(), z.unknown()).nullable(),
    metrics: z.record(z.string(), z.unknown()).nullable(),
    attributes: z.record(z.string(), z.unknown()).nullable(),
  })
  .loose()

export const resultItemSchema = z.object({
  kind: z.enum(["profile", "aggregation", "unknown"]),
  normalized: normalizedProfileSchema,
  raw: jsonValueSchema,
})

export type Location = z.infer<typeof locationSchema>
export type Ratings = z.infer<typeof ratingsSchema>
export type Pricing = z.infer<typeof pricingSchema>
export type Media = z.infer<typeof mediaSchema>
export type Source = z.infer<typeof sourceSchema>
export type NormalizedProfile = z.infer<typeof normalizedProfileSchema>
export type ResultItem = z.infer<typeof resultItemSchema>

export const makeLocation = (overrides: Partial<Location> = {}): Location => ({
  text: null,
  street_address: null,
  city: null,
  postcode: null,
  region: null,
  country: null,
  latitude: null,
  longitude: null,
  ...overrides,
})

export const makeRatings = (overrides: Partial<Ratings> = {}): Ratings => ({
  value: null,
  count: null,
  best: null,
  worst: null,
  average: null,
  ...overrides,
})

export const makePricing = (overrides: Partial<Pricing> = {}): Pricing => ({
  min: null,
  max: null,
  raw: null,
  currency: null,
  ...overrides,
})

export const makeMedia = (overrides: Partial<Media> = {}): Media => ({
  image_url: null,
  cover_urls: null,
  gallery_urls: null,
  video_urls: null,
  ...overrides,
})

export const makeSource = (overrides: Partial<Source> = {}): Source => ({
  url: null,
  slug: null,
  position: null,
  index: null,
  origin: null,
  ...overrides,
})

export interface MakeNormalizedResultArgs {
  website: string
  kind: "profile" | "aggregation"
  sourceId?: unknown
  name?: string | null
  url?: string | null
  slug?: string | null
  description?: string | null
  location?: Location
  ratings?: Ratings
  pricing?: Pricing
  categories?: unknown[] | null
  tags?: unknown[] | null
  media?: Media
  source?: Source
  flags?: Record<string, unknown> | null
  metrics?: Record<string, unknown> | null
  attributes?: Record<string, unknown> | null
}

export const makeNormalizedResult = (args: MakeNormalizedResultArgs): NormalizedProfile => ({
  website: args.website,
  kind: args.kind,
  id: args.sourceId ?? null,
  name: args.name ?? null,
  url: args.url ?? null,
  slug: args.slug ?? null,
  description: args.description ?? null,
  location: args.location ?? makeLocation(),
  ratings: args.ratings ?? makeRatings(),
  pricing: args.pricing ?? makePricing(),
  categories: args.categories ?? null,
  tags: args.tags ?? null,
  media: args.media ?? makeMedia(),
  source: args.source ?? makeSource(),
  flags: args.flags ?? null,
  metrics: args.metrics ?? null,
  attributes: args.attributes ?? null,
})
