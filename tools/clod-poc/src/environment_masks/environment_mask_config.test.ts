import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENVIRONMENTAL_MASK_SETTINGS,
  cloneEnvironmentalMaskSettings,
  parseEnvironmentalMaskConfig,
} from "./environment_mask_config.js";

describe("environmental mask config", () => {
  it("maps snake_case YAML to runtime settings", () => {
    const config = parseEnvironmentalMaskConfig(`
enabled: true
river_cobble:
  enabled: false
  strength: 0.75
  min_depth_m: 0.2
  max_depth_m: 1.8
  min_flow_strength: 0.1
  max_flow_strength: 2.5
  max_shore_distance_m: 7
  min_normal_y: 0.65
rapid_splash:
  flow_start: 0.4
  flow_end: 1.4
`, null);

    expect(config.enabled).toBe(true);
    expect(config.riverCobble).toEqual({
      enabled: false,
      strength: 0.75,
      minDepthM: 0.2,
      maxDepthM: 1.8,
      minFlowStrength: 0.1,
      maxFlowStrength: 2.5,
      maxShoreDistanceM: 7,
      minNormalY: 0.65,
    });
    expect(config.rapidSplash.flowStart).toBe(0.4);
    expect(config.rapidSplash.flowEnd).toBe(1.4);
  });

  it("clamps invalid ranges without inverting bands", () => {
    const config = parseEnvironmentalMaskConfig(`
river_cobble:
  strength: 5
  min_depth_m: 2
  max_depth_m: 1
  min_flow_strength: 3
  max_flow_strength: 1
  max_shore_distance_m: -4
  min_normal_y: -2
frost:
  wetness_suppression: 8
`, null);

    expect(config.riverCobble.strength).toBe(1);
    expect(config.riverCobble.maxDepthM).toBe(config.riverCobble.minDepthM);
    expect(config.riverCobble.maxFlowStrength).toBe(config.riverCobble.minFlowStrength);
    expect(config.riverCobble.maxShoreDistanceM).toBe(0);
    expect(config.riverCobble.minNormalY).toBe(0);
    expect(config.frost.wetnessSuppression).toBe(1);
  });

  it("deep-clones every mask section", () => {
    const clone = cloneEnvironmentalMaskSettings();
    expect(clone).toEqual(DEFAULT_ENVIRONMENTAL_MASK_SETTINGS);
    expect(clone.riverCobble).not.toBe(DEFAULT_ENVIRONMENTAL_MASK_SETTINGS.riverCobble);
    expect(clone.riverMist).not.toBe(DEFAULT_ENVIRONMENTAL_MASK_SETTINGS.riverMist);
    expect(clone.rapidSplash).not.toBe(DEFAULT_ENVIRONMENTAL_MASK_SETTINGS.rapidSplash);
    expect(clone.sunbeamMote).not.toBe(DEFAULT_ENVIRONMENTAL_MASK_SETTINGS.sunbeamMote);
    expect(clone.calmPool).not.toBe(DEFAULT_ENVIRONMENTAL_MASK_SETTINGS.calmPool);
    expect(clone.frost).not.toBe(DEFAULT_ENVIRONMENTAL_MASK_SETTINGS.frost);
    expect(clone.dew).not.toBe(DEFAULT_ENVIRONMENTAL_MASK_SETTINGS.dew);
    expect(clone.shoreDebris).not.toBe(DEFAULT_ENVIRONMENTAL_MASK_SETTINGS.shoreDebris);
  });

  it("falls back for malformed and non-object roots", () => {
    const warnings: string[] = [];
    const malformed = parseEnvironmentalMaskConfig("river_cobble: [", (message) => warnings.push(message));
    const list = parseEnvironmentalMaskConfig("[1, 2]", (message) => warnings.push(message));

    expect(malformed).toEqual(DEFAULT_ENVIRONMENTAL_MASK_SETTINGS);
    expect(list).toEqual(DEFAULT_ENVIRONMENTAL_MASK_SETTINGS);
    expect(warnings).toHaveLength(2);
  });
});
