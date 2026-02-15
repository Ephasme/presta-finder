import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core"

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(), // = runId, e.g. "20260215_143022"
  serviceType: text("service_type").notNull(),
  model: text("model").notNull(),
  location: text("location"),
  createdAt: text("created_at").notNull(), // ISO timestamp
})

export const profiles = sqliteTable(
  "profiles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id),
    provider: text("provider").notNull(),
    providerId: text("provider_id"),
    profileUrl: text("profile_url"),
    name: text("name").notNull(),
    profileJson: text("profile_json").notNull(), // JSON-serialized AnyServiceProfile
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_run_provider_target").on(table.runId, table.provider, table.profileUrl),
  ],
)

export const evaluations = sqliteTable("evaluations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileId: integer("profile_id")
    .notNull()
    .references(() => profiles.id),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id),
  score: integer("score"), // null if eval errored
  verdict: text("verdict"), // "yes" | "maybe" | "no" | null
  summary: text("summary"),
  evalJson: text("eval_json"), // JSON-serialized ReportRecord, null on error
  error: text("error"),
  rawOutput: text("raw_output"),
  requestId: text("request_id"),
  createdAt: text("created_at").notNull(),
})
