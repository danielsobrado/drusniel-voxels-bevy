import { describe, expect, it } from "vitest";
import { surfaceHeight, WATER_LEVEL } from "../terrain.js";
import type { PageFootprint } from "../types.js";
import { DEFAULT_STONE_SETTINGS, type StoneSettings } from "./stone_config.js";
import { classShares, generateRankedStoneInstances, generateStoneInstances } from "./stone_scatter.js";

// A large footprint over varied terrain so all three size classes appear.
const footprint: PageFootprint = { minX: 0, minZ: 0, maxX: 256, maxZ: 256 };
const settings: StoneSettings = { ...DEFAULT_STONE_SETTINGS, enabled: true, density: 1.0 };

describe("stone_scatter", () => {
  it("is deterministic: same seed yields an identical instance list", () => {
    const a = generateStoneInstances(footprint, settings);
    const b = generateStoneInstances(footprint, settings);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });

  it("differs for a different seed", () => {
    const a = generateStoneInstances(footprint, settings);
    const b = generateStoneInstances(footprint, { ...settings, seedSalt: settings.seedSalt + 1 });
    expect(a).not.toEqual(b);
  });

  it("never floats stones above the terrain surface", () => {
    const eps = 1e-6;
    for (const stone of generateStoneInstances(footprint, settings)) {
      // Centre is sunk into the ground, so it must sit at or below the surface height.
      expect(stone.y).toBeLessThanOrEqual(surfaceHeight(stone.x, stone.z) + eps);
    }
  });

  it("never places stones in or below standing water", () => {
    for (const stone of generateStoneInstances(footprint, settings)) {
      expect(surfaceHeight(stone.x, stone.z)).toBeGreaterThanOrEqual(
        WATER_LEVEL + settings.waterMarginM + settings.standingWaterCutoffM,
      );
    }
  });

  it("produces a plausible size stratification (small >= large)", () => {
    const shares = classShares(generateStoneInstances(footprint, settings));
    expect(shares.large + shares.medium + shares.small).toBeCloseTo(1, 5);
    expect(shares.small).toBeGreaterThan(shares.large);
    expect(shares.large).toBeGreaterThan(0);
    expect(shares.medium).toBeGreaterThan(0);
  });

  it("caps to maxInstances and the smaller budget is a stable prefix of the larger", () => {
    const full = generateStoneInstances(footprint, settings, 100000);
    const small = generateStoneInstances(footprint, settings, 50);
    expect(small.length).toBe(50);
    expect(small).toEqual(full.slice(0, 50));
  });

  it("can apply one global priority budget across multiple footprints", () => {
    const left = generateRankedStoneInstances({ minX: 0, minZ: 0, maxX: 256, maxZ: 256 }, settings);
    const right = generateRankedStoneInstances({ minX: 256, minZ: 0, maxX: 512, maxZ: 256 }, settings);
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
    const all = [...left, ...right].sort((a, b) => a.priority - b.priority);
    const firstLeft = all.findIndex((entry) => entry.instance.x < 256);
    const firstRight = all.findIndex((entry) => entry.instance.x >= 256);
    const global = all.slice(0, Math.max(firstLeft, firstRight) + 1);
    expect(global.some((entry) => entry.instance.x < 256)).toBe(true);
    expect(global.some((entry) => entry.instance.x >= 256)).toBe(true);
  });

  it("emits nothing when density is zero", () => {
    expect(generateStoneInstances(footprint, { ...settings, density: 0 })).toHaveLength(0);
  });
});
