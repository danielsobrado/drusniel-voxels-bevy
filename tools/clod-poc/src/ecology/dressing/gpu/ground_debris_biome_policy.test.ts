import { describe, expect, it } from "vitest";
import {
  groundDebrisBiomePolicy,
  groundDebrisCombinedWetness,
  groundDebrisFrostAmount,
} from "./ground_debris_biome_policy.js";

describe("ground-debris biome policy", () => {
  it("warms only organic debris in autumn", () => {
    expect(groundDebrisBiomePolicy("leaf_litter")?.autumnStrength).toBeGreaterThan(0);
    expect(groundDebrisBiomePolicy("needle_litter")?.autumnStrength).toBeGreaterThan(0);
    expect(groundDebrisBiomePolicy("twig_cluster")?.autumnStrength).toBeGreaterThan(0);
    expect(groundDebrisBiomePolicy("bark_chip_cluster")?.autumnStrength).toBeGreaterThan(0);
    expect(groundDebrisBiomePolicy("small_talus")?.autumnStrength).toBe(0);
    expect(groundDebrisBiomePolicy("river_cobbles")?.autumnStrength).toBe(0);
    expect(groundDebrisBiomePolicy("wet_stone_cluster")?.autumnStrength).toBe(0);
  });

  it("combines local wetness with biome dew without reducing either source", () => {
    const policy = groundDebrisBiomePolicy("river_cobbles")!;
    expect(groundDebrisCombinedWetness(0.8, 0.2, policy)).toBe(0.8);
    expect(groundDebrisCombinedWetness(0.1, 1, policy)).toBeCloseTo(0.72);
    expect(groundDebrisCombinedWetness(Number.NaN, 2, policy)).toBeCloseTo(0.72);
  });

  it("uses the stronger of seasonal frost and altitude snow", () => {
    const policy = groundDebrisBiomePolicy("small_talus")!;
    expect(groundDebrisFrostAmount(0.2, 0.9, policy)).toBeCloseTo(0.324);
    expect(groundDebrisFrostAmount(1, 0, policy)).toBeCloseTo(0.36);
  });

  it("does not claim unrelated dressing classes", () => {
    expect(groundDebrisBiomePolicy("dead_log_fresh")).toBeNull();
    expect(groundDebrisBiomePolicy("flower_patch")).toBeNull();
  });
});
