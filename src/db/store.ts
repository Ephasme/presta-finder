import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { homedir } from "node:os"

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { eq, and, gte } from "drizzle-orm"
import { z } from "zod"

import * as schema from "./schema.js"
import type { AnyServiceProfile } from "../service-types/merged.js"
import type { ReportRecord } from "../eval/evaluation.js"

// ── JSON column schemas ─────────────────────────────────────────────
// These validate data we ourselves serialized to the DB.

/**
 * Structural check for AnyServiceProfile deserialized from JSON.
 * Validates the discriminant fields present on every ServiceProfile variant.
 * The full shape is guaranteed by the write path (insertProfile serializes a typed value).
 */
const anyServiceProfileSchema = z.custom<AnyServiceProfile>((val) => {
  if (typeof val !== "object" || val === null) return false
  if (!("provider" in val) || typeof val.provider !== "string") return false
  if (!("serviceType" in val) || typeof val.serviceType !== "string") return false
  return true
})

/**
 * Full Zod schema matching the ReportRecord interface.
 */
const reportRecordSchema = z.object({
  score: z.number(),
  verdict: z.enum(["yes", "maybe", "no"]),
  summary: z.string(),
  pros: z.array(z.string()),
  cons: z.array(z.string()),
  risks: z.array(z.string()),
  missing_info: z.array(z.string()),
  questions: z.array(z.string()),
  score_breakdown: z.record(z.string(), z.number()).nullable(),
  score_justifications: z.record(z.string(), z.string()).optional(),
})

// ── Public types ────────────────────────────────────────────────────

export interface EvalInsertArgs {
  score: number | null
  verdict: "yes" | "maybe" | "no" | null
  summary: string | null
  evalJson: ReportRecord | null
  error: string | null
  rawOutput: string | null
  requestId: string | null
}

export interface EvaluationRow {
  profile: AnyServiceProfile
  score: number | null
  verdict: string | null
  summary: string | null
  evalJson: ReportRecord | null
  error: string | null
  rawOutput: string | null
  requestId: string | null
}

export interface RunStats {
  profileCount: number
  evaluatedCount: number
  errorCount: number
  verdictCounts: Record<string, number>
}

// ── RunStore ────────────────────────────────────────────────────────

const DEFAULT_DB_PATH = () => resolve(homedir(), ".presta-finder", "evals.db")

export class RunStore {
  private db: BetterSQLite3Database<typeof schema>
  private sqlite: InstanceType<typeof Database>

  private constructor(
    db: BetterSQLite3Database<typeof schema>,
    sqlite: InstanceType<typeof Database>,
    private runId: string,
  ) {
    this.db = db
    this.sqlite = sqlite
  }

  /** Factory: opens DB, runs pending migrations, returns ready instance. */
  static async open(runId: string, dbPath?: string): Promise<RunStore> {
    const resolvedPath = dbPath ?? DEFAULT_DB_PATH()
    await mkdir(dirname(resolvedPath), { recursive: true })
    const sqlite = new Database(resolvedPath)
    sqlite.pragma("journal_mode = WAL")
    const db = drizzle(sqlite, { schema })
    migrate(db, {
      migrationsFolder: resolve(import.meta.dirname, "../../drizzle"),
    })
    return new RunStore(db, sqlite, runId)
  }

  async createRun(meta: {
    serviceType: string
    model: string
    location: string | null
  }): Promise<void> {
    await this.db.insert(schema.runs).values({
      id: this.runId,
      serviceType: meta.serviceType,
      model: meta.model,
      location: meta.location,
      createdAt: new Date().toISOString(),
    })
  }

  /** Insert a profile and return its auto-incremented id. */
  async insertProfile(profile: AnyServiceProfile): Promise<number> {
    const result = await this.db
      .insert(schema.profiles)
      .values({
        runId: this.runId,
        provider: profile.provider,
        providerId: profile.providerId ?? null,
        profileUrl: profile.profileUrl ?? null,
        name: profile.name ?? profile.provider,
        profileJson: JSON.stringify(profile),
        createdAt: new Date().toISOString(),
      })
      .returning({ id: schema.profiles.id })

    return result[0].id
  }

  async insertEvaluation(profileId: number, args: EvalInsertArgs): Promise<void> {
    await this.db.insert(schema.evaluations).values({
      profileId,
      runId: this.runId,
      score: args.score,
      verdict: args.verdict,
      summary: args.summary,
      evalJson: args.evalJson ? JSON.stringify(args.evalJson) : null,
      error: args.error,
      rawOutput: args.rawOutput,
      requestId: args.requestId,
      createdAt: new Date().toISOString(),
    })
  }

  /**
   * Query evaluated profiles with score >= minScore for the current run.
   * Returns joined profile + evaluation data, sorted by score descending.
   */
  async getEvaluatedProfiles(minScore: number): Promise<EvaluationRow[]> {
    const rows = await this.db
      .select({
        profileJson: schema.profiles.profileJson,
        score: schema.evaluations.score,
        verdict: schema.evaluations.verdict,
        summary: schema.evaluations.summary,
        evalJson: schema.evaluations.evalJson,
        error: schema.evaluations.error,
        rawOutput: schema.evaluations.rawOutput,
        requestId: schema.evaluations.requestId,
      })
      .from(schema.evaluations)
      .innerJoin(schema.profiles, eq(schema.evaluations.profileId, schema.profiles.id))
      .where(
        and(
          eq(schema.evaluations.runId, this.runId),
          gte(schema.evaluations.score, minScore),
        ),
      )
      .orderBy(schema.evaluations.score)

    // Drizzle returns ascending; reverse for descending
    rows.reverse()

    return rows.map((row) => ({
      profile: anyServiceProfileSchema.parse(JSON.parse(row.profileJson)),
      score: row.score,
      verdict: row.verdict,
      summary: row.summary,
      evalJson: row.evalJson ? reportRecordSchema.parse(JSON.parse(row.evalJson)) : null,
      error: row.error,
      rawOutput: row.rawOutput,
      requestId: row.requestId,
    }))
  }

  async getStats(): Promise<RunStats> {
    const allEvals = await this.db
      .select({
        score: schema.evaluations.score,
        verdict: schema.evaluations.verdict,
        error: schema.evaluations.error,
      })
      .from(schema.evaluations)
      .where(eq(schema.evaluations.runId, this.runId))

    const allProfiles = await this.db
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .where(eq(schema.profiles.runId, this.runId))

    const verdictCounts: Record<string, number> = {}
    let errorCount = 0
    for (const row of allEvals) {
      if (row.error) {
        errorCount += 1
      }
      if (row.verdict) {
        verdictCounts[row.verdict] = (verdictCounts[row.verdict] ?? 0) + 1
      }
    }

    return {
      profileCount: allProfiles.length,
      evaluatedCount: allEvals.length,
      errorCount,
      verdictCounts,
    }
  }

  close(): void {
    this.sqlite.close()
  }
}
