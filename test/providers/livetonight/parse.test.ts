import { describe, expect, it } from "vitest"

import { parseLiveTonight } from "../../../src/providers/livetonight/parse.js"

describe("livetonight parse", () => {
  it("parses profiles even when aggregations is a boolean flag", () => {
    const payload = {
      final: {
        body: {
          took: 500,
          timed_out: false,
          hits: {
            total: { value: 1, relation: "eq" },
            max_score: null,
            hits: [
              {
                _index: "users",
                _type: "_doc",
                _id: "17077",
                _score: 0,
                _source: {
                  id: 17077,
                  band_name: "Dj Dju",
                  slug: "17077-dj-dju",
                  address: "Grasse, France",
                  categories: ["DJ"],
                  contracts_public: [],
                },
                sort: [1, 0, 7.03],
              },
            ],
          },
        },
        aggregations: true,
        resultCountToShow: 1,
      },
    }

    const parsed = parseLiveTonight(payload)
    expect(parsed.meta.kind).toBe("profiles")
    expect(parsed.meta.count).toBe(1)
    expect(parsed.results).toHaveLength(1)
    expect(parsed.results[0]?.kind).toBe("profile")
  })
})
