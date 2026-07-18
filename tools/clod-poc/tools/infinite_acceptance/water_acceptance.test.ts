import { describe, expect, it } from "vitest";
import {
  WATER_ACCEPTANCE_MAX_FRAME_MS,
  WATER_ACCEPTANCE_MAX_P95_MS,
  WATER_ACCEPTANCE_MIN_ATLAS_LEVELS,
  evaluateWaterAcceptance,
} from "./water_acceptance.js";

function passingInput() {
  return {
    startupTimings: { river_continuity_pct: 100 },
    counters: {
      webgpu_uncaptured_errors: 0,
      water_high_quality_material_active: 1,
      water_ssr_active: 1,
      water_refraction_active: 1,
      water_caustics_active: 1,
      water_clipmap_enabled: 1,
      water_clipmap_visible_levels: WATER_ACCEPTANCE_MIN_ATLAS_LEVELS,
      water_clipmap_level_count: WATER_ACCEPTANCE_MIN_ATLAS_LEVELS,
      water_atlas_driven_level_count: WATER_ACCEPTANCE_MIN_ATLAS_LEVELS,
      water_clipmap_outer_half_span_m: 768,
      far_clipmap_inner_radius_m: 384,
      water_clipmap_snaps: WATER_ACCEPTANCE_MIN_ATLAS_LEVELS * 2,
      water_clipmap_field_samples: 0,
      "framePerf.p95.waterMs": WATER_ACCEPTANCE_MAX_P95_MS,
      "framePerf.max.waterMs": WATER_ACCEPTANCE_MAX_FRAME_MS,
    },
  };
}

describe("water acceptance", () => {
  it("accepts complete high-quality atlas-driven water evidence at the timing limits", () => {
    expect(evaluateWaterAcceptance(passingInput())).toEqual([]);
  });

  it("fails missing or regressed water evidence", () => {
    const input = passingInput();
    input.startupTimings.river_continuity_pct = 94;
    input.counters.webgpu_uncaptured_errors = 1;
    input.counters.water_high_quality_material_active = 0;
    input.counters.water_ssr_active = 0;
    input.counters.water_refraction_active = 0;
    input.counters.water_caustics_active = 0;
    input.counters.water_clipmap_enabled = 0;
    input.counters.water_clipmap_level_count = 0;
    input.counters.water_atlas_driven_level_count = 0;
    input.counters.water_clipmap_visible_levels = 0;
    input.counters.water_clipmap_outer_half_span_m = 0;
    input.counters.far_clipmap_inner_radius_m = 0;
    input.counters.water_clipmap_snaps = 0;
    input.counters.water_clipmap_field_samples = 1;
    input.counters["framePerf.p95.waterMs"] = WATER_ACCEPTANCE_MAX_P95_MS + 0.1;
    input.counters["framePerf.max.waterMs"] = WATER_ACCEPTANCE_MAX_FRAME_MS + 0.1;

    expect(evaluateWaterAcceptance(input)).toEqual(expect.arrayContaining([
      expect.stringContaining("river_continuity_pct"),
      expect.stringContaining("webgpu_uncaptured_errors"),
      expect.stringContaining("water_high_quality_material_active"),
      expect.stringContaining("water_ssr_active"),
      expect.stringContaining("water_refraction_active"),
      expect.stringContaining("water_caustics_active"),
      expect.stringContaining("water_clipmap_enabled"),
      expect.stringContaining("water_clipmap_level_count"),
      expect.stringContaining("water_atlas_driven_level_count"),
      expect.stringContaining("water_clipmap_visible_levels"),
      expect.stringContaining("water_clipmap_outer_half_span_m"),
      expect.stringContaining("far_clipmap_inner_radius_m"),
      expect.stringContaining("water_clipmap_snaps"),
      expect.stringContaining("water_clipmap_field_samples"),
      expect.stringContaining("framePerf.p95.waterMs"),
      expect.stringContaining("framePerf.max.waterMs"),
    ]));
  });

  it("rejects a reduced atlas ring count even when every remaining ring is visible", () => {
    const input = passingInput();
    input.counters.water_clipmap_level_count = WATER_ACCEPTANCE_MIN_ATLAS_LEVELS - 1;
    input.counters.water_atlas_driven_level_count = WATER_ACCEPTANCE_MIN_ATLAS_LEVELS - 1;
    input.counters.water_clipmap_visible_levels = WATER_ACCEPTANCE_MIN_ATLAS_LEVELS - 1;
    input.counters.water_clipmap_snaps = WATER_ACCEPTANCE_MIN_ATLAS_LEVELS - 1;

    expect(evaluateWaterAcceptance(input)).toEqual([
      `water_clipmap_level_count=${WATER_ACCEPTANCE_MIN_ATLAS_LEVELS - 1} must be an integer >= ${WATER_ACCEPTANCE_MIN_ATLAS_LEVELS}`,
    ]);
  });

  it("rejects non-atlas clipmap levels", () => {
    const input = passingInput();
    input.counters.water_atlas_driven_level_count = WATER_ACCEPTANCE_MIN_ATLAS_LEVELS - 1;

    expect(evaluateWaterAcceptance(input)).toEqual([
      `water_atlas_driven_level_count=${WATER_ACCEPTANCE_MIN_ATLAS_LEVELS - 1} must equal water_clipmap_level_count=${WATER_ACCEPTANCE_MIN_ATLAS_LEVELS}`,
    ]);
  });

  it("rejects partial ring visibility and uninitialized clipmap levels", () => {
    const input = passingInput();
    input.counters.water_clipmap_visible_levels = WATER_ACCEPTANCE_MIN_ATLAS_LEVELS - 1;
    input.counters.water_clipmap_snaps = WATER_ACCEPTANCE_MIN_ATLAS_LEVELS - 2;

    expect(evaluateWaterAcceptance(input)).toEqual(expect.arrayContaining([
      expect.stringContaining(`must equal water_clipmap_level_count=${WATER_ACCEPTANCE_MIN_ATLAS_LEVELS}`),
      expect.stringContaining(`water_clipmap_snaps=${WATER_ACCEPTANCE_MIN_ATLAS_LEVELS - 2}`),
    ]));
  });

  it("rejects a gap between near water and the far clipmap", () => {
    const input = passingInput();
    input.counters.water_clipmap_outer_half_span_m = 256;

    expect(evaluateWaterAcceptance(input)).toEqual([
      "water_clipmap_outer_half_span_m=256 must cover far_clipmap_inner_radius_m=384",
    ]);
  });

  it("rejects a selected high tier when advanced features are inactive", () => {
    const input = passingInput();
    input.counters.water_ssr_active = 0;
    input.counters.water_refraction_active = 0;
    input.counters.water_caustics_active = 0;

    expect(evaluateWaterAcceptance(input)).toEqual(expect.arrayContaining([
      "water_ssr_active=0 must equal 1",
      "water_refraction_active=0 must equal 1",
      "water_caustics_active=0 must equal 1",
    ]));
  });

  it("rejects inconsistent timing envelopes", () => {
    const input = passingInput();
    input.counters["framePerf.p95.waterMs"] = 0.4;
    input.counters["framePerf.max.waterMs"] = 0.3;

    expect(evaluateWaterAcceptance(input)).toEqual([
      "framePerf.max.waterMs=0.3 must be >= framePerf.p95.waterMs=0.4",
    ]);
  });
});
