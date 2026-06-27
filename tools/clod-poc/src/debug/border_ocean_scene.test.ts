import { describe, expect, it } from "vitest";
import yamlText from "../../config/border_ocean_scene.yaml?raw";
import {
  DEFAULT_BORDER_OCEAN_REQUIRED_COUNTERS,
  parseBorderOceanSceneConfig,
  probeCliffDryAboveSea,
  probePlayableOceanOutside,
  validateBorderOceanStats,
} from "./border_ocean_scene.js";
import { DEFAULT_BORDER_COAST_OCEAN_CONFIG } from "../terrain/border_coast_config.js";
import { createDeepOceanSampler } from "../water/ocean_service.js";
import { countDeepOceanTransitionGapVertices, deepOceanSurfaceTriangleCount } from "../water/deep_ocean_surface.js";

function validStats(): Record<string, unknown> {
  return {
    ready: true,
    error: null,
    counters: {
      "border_ocean.scene": 1,
      "border_ocean.coast_runtime_active": 1,
      "border_ocean.deep_ocean_enabled": 1,
      "border_ocean.deep_ocean_mesh_present": 1,
      "border_ocean.deep_ocean_vertices": 5000,
      "border_ocean.deep_ocean_triangles": 8192,
      "border_ocean.deep_ocean_draw_calls": 1,
      "border_ocean.deep_ocean_start_outside_m": 64,
      "border_ocean.deep_ocean_extend_m": 4096,
      "border_ocean.deep_ocean_surface_y": 18,
      "border_ocean.deep_ocean_transition_gap_vertices": 0,
      "border_ocean.wave_count": 54,
      "border_ocean.wave_wind_speed": 14,
      "border_ocean.wave_height_scale": 1.3,
      "border_ocean.wave_choppiness": 1.6,
      "border_ocean.shading_fog_far_m": 1800,
      "border_ocean.shading_reflection_strength": 0.46,
      "border_ocean.player_margin_m": 16,
      "border_ocean.player_pushback_band_m": 48,
      "border_ocean.player_pushback_accel": 36,
      "border_ocean.player_soft_pushback_enabled": 1,
      "border_ocean.frame_ms_p95": 16.7,
      "border_ocean.page_source_purity": 1,
      "border_ocean.interior_water_wet_ratio": 0.05,
      "border_ocean.playable_ocean_outside_ok": 1,
      "border_ocean.cliff_dry_above_sea": probeCliffDryAboveSea(18, 256),
    },
  };
}

describe("border-ocean acceptance probes", () => {
  it("parses required counters and thresholds from scene YAML", () => {
    const config = parseBorderOceanSceneConfig(yamlText);

    expect(config.acceptance.requiredCounters).toEqual([...DEFAULT_BORDER_OCEAN_REQUIRED_COUNTERS]);
    expect(config.acceptance.requiredCounters).toContain("border_ocean.player_margin_m");
    expect(config.acceptance.requiredCounters).toContain("border_ocean.player_soft_pushback_enabled");
    expect(config.acceptance.requiredCounters).toContain("border_ocean.deep_ocean_transition_gap_vertices");
    expect(config.acceptance.requiredCounters).toContain("border_ocean.frame_ms_p95");
    expect(config.acceptance.maxDeepOceanTriangles).toBe(600000);
    expect(config.acceptance.maxDeepOceanDrawCalls).toBe(1);
    expect(config.acceptance.maxTransitionGapVertices).toBe(0);
    expect(config.acceptance.maxFrameMsP95).toBe(50);
    expect(config.acceptance.maxWebglWebgpuMeanDelta).toBe(18);
    expect(config.acceptance.maxWebglWebgpuP95Delta).toBe(80);
  });

  it("fails clearly when root config is malformed", () => {
    expect(() => parseBorderOceanSceneConfig("[]\n")).toThrow("root must be an object");
  });

  it("fails clearly when camera config is malformed", () => {
    expect(() => parseBorderOceanSceneConfig(yamlText.replace("eye_y_ratio: 0.14", "eye_y_ratio: high"))).toThrow(
      "border_ocean_scene.camera.eye_y_ratio must be a finite number",
    );
  });

  it("fails clearly when integer acceptance config is malformed", () => {
    expect(() => parseBorderOceanSceneConfig(yamlText.replace("min_deep_ocean_vertices: 1000", "min_deep_ocean_vertices: 1000.5"))).toThrow(
      "border_ocean_scene.acceptance.min_deep_ocean_vertices must be an integer",
    );
  });

  it("fails clearly when numeric acceptance config is below range", () => {
    expect(() => parseBorderOceanSceneConfig(yamlText.replace("max_frame_ms_p95: 50", "max_frame_ms_p95: -1"))).toThrow(
      "border_ocean_scene.acceptance.max_frame_ms_p95 must be >= 0",
    );
  });

  it("fails clearly when required counters config has invalid values", () => {
    expect(() => parseBorderOceanSceneConfig(yamlText.replace("- border_ocean.scene", "- 7"))).toThrow(
      "acceptance.required_counters[0] must be a non-empty string",
    );
  });

  it("validates outside-ocean sampler", () => {
    const sampler = createDeepOceanSampler(1024, {
      ...DEFAULT_BORDER_COAST_OCEAN_CONFIG.deepOcean,
      startOutsideBorderM: 64,
      extendCells: 384,
      surfaceY: 18,
      segments: 64,
    });
    expect(probePlayableOceanOutside(sampler, 1024)).toBe(1);
  });

  it("keeps the ring mesh out of the configured gap", () => {
    const config = {
      ...DEFAULT_BORDER_COAST_OCEAN_CONFIG.deepOcean,
      startOutsideBorderM: 64,
      extendCells: 384,
      segments: 64,
    };
    expect(countDeepOceanTransitionGapVertices(1024, config)).toBe(0);
    expect(deepOceanSurfaceTriangleCount(1024, config)).toBeGreaterThan(0);
  });

  it("validates synthetic stats payload", () => {
    validateBorderOceanStats(validStats());
  });

  it("fails when gap vertices are reported", () => {
    const stats = validStats();
    (stats.counters as Record<string, unknown>)["border_ocean.deep_ocean_transition_gap_vertices"] = 1;
    expect(() => validateBorderOceanStats(stats)).toThrow("border-ocean counter failed: border_ocean.deep_ocean_transition_gap_vertices=1");
  });

  it("fails when frame p95 is over the parsed threshold", () => {
    const stats = validStats();
    (stats.counters as Record<string, unknown>)["border_ocean.frame_ms_p95"] = 51;
    expect(() => validateBorderOceanStats(stats, parseBorderOceanSceneConfig(yamlText))).toThrow(
      "border-ocean counter failed: border_ocean.frame_ms_p95=51",
    );
  });

  it("fails clearly when a YAML-required counter is missing", () => {
    const config = parseBorderOceanSceneConfig(yamlText);
    const stats = validStats();
    delete (stats.counters as Record<string, unknown>)["border_ocean.player_margin_m"];

    expect(() => validateBorderOceanStats(stats, config)).toThrow(
      "border-ocean required counter missing: border_ocean.player_margin_m",
    );
  });

  it("fails clearly when a YAML-required counter is non-finite", () => {
    const config = parseBorderOceanSceneConfig(yamlText);
    const stats = validStats();
    (stats.counters as Record<string, unknown>)["border_ocean.player_margin_m"] = Number.NaN;

    expect(() => validateBorderOceanStats(stats, config)).toThrow(
      "border-ocean required counter missing: border_ocean.player_margin_m",
    );
  });
});
