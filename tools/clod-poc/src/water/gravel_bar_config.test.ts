import { afterEach, describe, expect, it } from "vitest";
import { cloneHydrologyConfig } from "./hydrologyConfig.js";
import { parseWaterConfig } from "./waterConfig.js";
import { readGravelBarSettings, setGravelBarSettings } from "./gravel_bar_runtime.js";

const MINIMAL_WATER = `
water:
  hydrology:
    gravel_bars:
      enabled: true
      stones_enabled: true
      strength: 5
      seed_salt: 77.9
      longitudinal_period_m: 2
      cross_period_m: 0
      pattern_start: 0.8
      pattern_end: 0.2
      breakup_strength: -1
      min_shore_distance_m: 8
      max_shore_distance_m: 3
      min_depth_m: 2
      max_depth_m: 1
      min_flow_strength: 3
      max_flow_strength: 1
`;

afterEach(() => {
  setGravelBarSettings(cloneHydrologyConfig().gravelBars);
});

describe("gravel bar hydrology config", () => {
  it("parses and clamps inverted or unsafe ranges", () => {
    const gravel = parseWaterConfig(MINIMAL_WATER, null).hydrology.gravelBars;
    expect(gravel.stonesEnabled).toBe(true);
    expect(gravel.strength).toBe(1);
    expect(gravel.seedSalt).toBe(77);
    expect(gravel.longitudinalPeriodM).toBe(8);
    expect(gravel.crossPeriodM).toBe(2);
    expect(gravel.patternEnd).toBe(gravel.patternStart);
    expect(gravel.breakupStrength).toBe(0);
    expect(gravel.maxShoreDistanceM).toBe(gravel.minShoreDistanceM);
    expect(gravel.maxDepthM).toBe(gravel.minDepthM);
    expect(gravel.maxFlowStrength).toBe(gravel.minFlowStrength);
  });

  it("publishes the resolved settings to query and shader consumers", () => {
    const parsed = parseWaterConfig(MINIMAL_WATER, null).hydrology.gravelBars;
    expect(readGravelBarSettings()).toEqual(parsed);
  });
});
