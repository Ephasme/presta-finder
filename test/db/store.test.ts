import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { RunStore } from "../../src/db/store.js"
import type { ServiceProfile } from "../../src/service-types/types.js"

const makeTestProfile = (
  overrides: Partial<ServiceProfile<"wedding-dj">> = {},
): ServiceProfile<"wedding-dj"> => ({
  serviceType: "wedding-dj",
  provider: "1001dj",
  providerId: "42",
  name: "DJ Test",
  profileUrl: "https://example.com/dj-test",
  reputation: {
    rating: 4.5,
    reviewCount: 10,
    reviewHighlights: [],
  },
  location: {
    city: "Paris",
    region: "IDF",
    serviceArea: [],
    travelPolicy: null,
  },
  availability: {
    availableDates: [],
    leadTimeDays: null,
    bookingStatus: null,
  },
  professionalism: {
    isVerified: null,
    yearsExperience: null,
    responseTime: null,
    contractProvided: null,
    insurance: null,
  },
  media: {
    photosCount: 5,
    videosCount: 2,
    portfolioLinks: [],
  },
  communication: {
    languages: [],
    responseChannels: [],
  },
  policies: {
    cancellationPolicy: null,
    requirements: [],
  },
  budgetSummary: {
    minKnownPrice: 800,
    maxKnownPrice: 1200,
    hasTransparentPricing: true,
    budgetFit: "good",
  },
  offers: [],
  serviceSpecific: {
    musicalStyles: [],
    djSetFormats: [],
    mcServices: null,
    soundEquipment: [],
    lightingEquipment: [],
    specialMomentsSupport: [],
  },
  ...overrides,
})

describe("RunStore", () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "runstore-test-"))
    dbPath = join(tmpDir, "test.db")
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it("opens and creates a run", async () => {
    const store = await RunStore.open("test_run_001", dbPath)
    await store.createRun({
      serviceType: "wedding-dj",
      model: "gpt-5-nano",
      location: "Paris",
    })

    const stats = await store.getStats()
    expect(stats.profileCount).toBe(0)
    expect(stats.evaluatedCount).toBe(0)
    store.close()
  })

  it("inserts a profile and returns an id", async () => {
    const store = await RunStore.open("test_run_002", dbPath)
    await store.createRun({
      serviceType: "wedding-dj",
      model: "gpt-5-nano",
      location: "Paris",
    })

    const profile = makeTestProfile()
    const id = await store.insertProfile(profile)
    expect(id).toBeGreaterThan(0)

    const stats = await store.getStats()
    expect(stats.profileCount).toBe(1)
    store.close()
  })

  it("inserts an evaluation and retrieves it", async () => {
    const store = await RunStore.open("test_run_003", dbPath)
    await store.createRun({
      serviceType: "wedding-dj",
      model: "gpt-5-nano",
      location: "Paris",
    })

    const profile = makeTestProfile()
    const profileId = await store.insertProfile(profile)

    await store.insertEvaluation(profileId, {
      score: 85,
      verdict: "yes",
      summary: "Great DJ",
      evalJson: {
        score: 85,
        verdict: "yes",
        summary: "Great DJ",
        pros: ["Good reviews"],
        cons: [],
        risks: [],
        missing_info: [],
        questions: [],
        score_breakdown: null,
      },
      error: null,
      rawOutput: null,
      requestId: "req_123",
    })

    const results = await store.getEvaluatedProfiles(60)
    expect(results).toHaveLength(1)
    expect(results[0]?.score).toBe(85)
    expect(results[0]?.verdict).toBe("yes")
    expect(results[0]?.profile.name).toBe("DJ Test")
    expect(results[0]?.evalJson?.score).toBe(85)

    store.close()
  })

  it("filters by minScore", async () => {
    const store = await RunStore.open("test_run_004", dbPath)
    await store.createRun({
      serviceType: "wedding-dj",
      model: "gpt-5-nano",
      location: "Paris",
    })

    const p1 = makeTestProfile({ name: "DJ Low", profileUrl: "https://example.com/low" })
    const p1Id = await store.insertProfile(p1)
    await store.insertEvaluation(p1Id, {
      score: 40,
      verdict: "no",
      summary: "Not great",
      evalJson: {
        score: 40,
        verdict: "no",
        summary: "Not great",
        pros: [],
        cons: ["Low quality"],
        risks: [],
        missing_info: [],
        questions: [],
        score_breakdown: null,
      },
      error: null,
      rawOutput: null,
      requestId: null,
    })

    const p2 = makeTestProfile({ name: "DJ High", profileUrl: "https://example.com/high" })
    const p2Id = await store.insertProfile(p2)
    await store.insertEvaluation(p2Id, {
      score: 90,
      verdict: "yes",
      summary: "Excellent",
      evalJson: {
        score: 90,
        verdict: "yes",
        summary: "Excellent",
        pros: ["Top quality"],
        cons: [],
        risks: [],
        missing_info: [],
        questions: [],
        score_breakdown: null,
      },
      error: null,
      rawOutput: null,
      requestId: null,
    })

    // minScore=60 should only return DJ High
    const results = await store.getEvaluatedProfiles(60)
    expect(results).toHaveLength(1)
    expect(results[0]?.profile.name).toBe("DJ High")

    // minScore=0 should return both
    const allResults = await store.getEvaluatedProfiles(0)
    expect(allResults).toHaveLength(2)

    store.close()
  })

  it("returns sorted results (highest score first)", async () => {
    const store = await RunStore.open("test_run_005", dbPath)
    await store.createRun({
      serviceType: "wedding-dj",
      model: "gpt-5-nano",
      location: "Paris",
    })

    const profiles = [
      makeTestProfile({ name: "DJ A", profileUrl: "https://example.com/a" }),
      makeTestProfile({ name: "DJ B", profileUrl: "https://example.com/b" }),
      makeTestProfile({ name: "DJ C", profileUrl: "https://example.com/c" }),
    ]

    const scores = [70, 90, 80]
    for (const [i, profile] of profiles.entries()) {
      const pid = await store.insertProfile(profile)
      await store.insertEvaluation(pid, {
        score: scores[i] ?? 0,
        verdict: "yes",
        summary: `Score ${scores[i]}`,
        evalJson: {
          score: scores[i] ?? 0,
          verdict: "yes",
          summary: `Score ${scores[i]}`,
          pros: [],
          cons: [],
          risks: [],
          missing_info: [],
          questions: [],
          score_breakdown: null,
        },
        error: null,
        rawOutput: null,
        requestId: null,
      })
    }

    const results = await store.getEvaluatedProfiles(0)
    expect(results).toHaveLength(3)
    expect(results[0]?.score).toBe(90)
    expect(results[1]?.score).toBe(80)
    expect(results[2]?.score).toBe(70)

    store.close()
  })

  it("getStats returns correct counts", async () => {
    const store = await RunStore.open("test_run_006", dbPath)
    await store.createRun({
      serviceType: "wedding-dj",
      model: "gpt-5-nano",
      location: "Paris",
    })

    const p1 = makeTestProfile({ name: "DJ 1", profileUrl: "https://example.com/1" })
    const p1Id = await store.insertProfile(p1)
    await store.insertEvaluation(p1Id, {
      score: 85,
      verdict: "yes",
      summary: "Good",
      evalJson: null,
      error: null,
      rawOutput: null,
      requestId: null,
    })

    const p2 = makeTestProfile({ name: "DJ 2", profileUrl: "https://example.com/2" })
    const p2Id = await store.insertProfile(p2)
    await store.insertEvaluation(p2Id, {
      score: null,
      verdict: null,
      summary: null,
      evalJson: null,
      error: "API error: timeout",
      rawOutput: null,
      requestId: null,
    })

    const p3 = makeTestProfile({ name: "DJ 3", profileUrl: "https://example.com/3" })
    await store.insertProfile(p3)
    // No evaluation for p3

    const stats = await store.getStats()
    expect(stats.profileCount).toBe(3)
    expect(stats.evaluatedCount).toBe(2)
    expect(stats.errorCount).toBe(1)
    expect(stats.verdictCounts).toEqual({ yes: 1 })

    store.close()
  })

  it("persists across close and reopen", async () => {
    const store1 = await RunStore.open("test_run_007", dbPath)
    await store1.createRun({
      serviceType: "wedding-dj",
      model: "gpt-5-nano",
      location: "Paris",
    })

    const profile = makeTestProfile()
    await store1.insertProfile(profile)
    store1.close()

    // Reopen with a different runId to verify data isolation
    const store2 = await RunStore.open("test_run_007", dbPath)
    const stats = await store2.getStats()
    expect(stats.profileCount).toBe(1)
    store2.close()
  })
})
