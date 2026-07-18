import { describe, expect, it } from "vitest";
import {
  WATER_ACCEPTANCE_MAX_FRAME_MS,
  WATER_ACCEPTANCE_MAX_P95_MS,
  evaluateWaterAcceptance,
} from "./water_acceptance.js";

function passingInput() {
  return {
    startupTimings: { river_continuity_pct: 100 },
    counters: {
      webgpu_uncaptured_errors: 0,
      water_clipmap_enabled: 1,
      water_clipmap_visible_levels: 4,
      water_clipmap_level_count: 4,
      water_clipmap_field_samples: 0,
      "framePerf.p95.waterMs": WATER_ACCEPTANCE_MAX_P95_MS,
      "framePerf.max.waterMs": WATER_ACCEPTANCE_MAX_FRAME_MS,
    },
  };
}

describe("water acceptance", () => {
  it("accepts the atlas-driven water budget and continuity evidence", () => {
    expect(evaluateWaterAcceptance(passingInput())).toEqual([]);
  });

  it("fails missing or regressed water evidence", () => {
    const input = passingInput();
    input.startupTimings.river_continuity_pct = 94;
    input.counters.webgpu_uncaptured_errors = 1;
    input.counters.water_clipmap_visible_levels = 0;
    input.counters.water_clipmap_field_samples = 1;
    input.counters["framePerf.p95.waterMs"] = WATER_ACCEPTANCE_MAX_P95_MS + 0.1;
    input.counters["framePerf.max.waterMs"] = WATER_ACCEPTANCE_MAX_FRAME_MS + 0.1;

    expect(evaluateWaterAcceptance(input)).toEqual(expect.arrayContaining([
      expect.stringContaining("river_continuity_pct"),
      expect.stringContaining("webgpu_uncaptured_errors"),
      expect.stringContaining("water_clipmap_visible_levels"),
      expect.stringContaining("water_clipmap_field_samples"),
      expect.stringContaining("framePerf.p95.waterMs"),
      expect.stringContaining("framePerf.max.waterMs"),
    ]));
  });
});
