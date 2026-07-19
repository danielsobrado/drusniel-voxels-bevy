import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bindActiveEnvironmentQuery } from "../environment_query/runtime.js";
import { surfaceHeight, WATER_LEVEL } from "../terrain/terrain.js";
import type { PageFootprint } from "../types.js";
import { DEFAULT_STONE_SETTINGS, type StoneSettings } from "./stone_config.js";
import type { StoneEnvironmentSource } from "./stone_environment_sampler.js";
import { classShares, generateRankedStoneInstances, generateStoneInstances } from "./stone_scatter.js";

const footprint: PageFootprint = { minX: 0, minZ: 0, maxX: 256, maxZ: 256 };
const settings: StoneSettings = { ...DEFAULT_STONE_SETTINGS, enabled: true, density: 1.0 };

beforeEach(() => bindActiveEnvironmentQuery(null));
afterEach(() => bindActiveEnvironmentQuery(null));

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
    const epsilon = 1e-6;
    for (const stone of generateStoneInstances(footprint, settings)) {
      expect(stone.y).toBeLessThanOrEqual(surfaceHeight(stone.x, stone.z) + epsilon);
    }
  });

  it("never places stones in or below standing water", () => {
    for (const stone of generateStoneInstances(footprint, settings)) {
      expect(surfaceHeight(stone.x, stone.z)).toBeGreaterThanOrEqual(
        WATER_LEVEL + settings.waterMarginM + settings.standingWaterCutoffM,
      );
    }
  });

  it("produces a plausible size stratification", () => {
    const shares = classShares(generateStoneInstances(footprint, settings));
    expect(shares.large + shares.medium + shares.small).toBeCloseTo(1, 5);
    expect(shares.small).toBeGreaterThan(shares.large);
    expect(shares.large).toBeGreaterThan(0);
    expect(shares.medium).toBeGreaterThan(0);
  });

  it("caps to maxInstances and keeps smaller budgets as stable prefixes", () => {
    const full = generateStoneInstances(footprint, settings, 100_000);
    const small = generateStoneInstances(footprint, settings, 50);
    expect(small.length).toBe(50);
    expect(small).toEqual(full.slice(0, 50));
  });

  it("can apply one global priority budget across multiple footprints", () => {
    const left = generateRankedStoneInstances(
      { minX: 0, minZ: 0, maxX: 256, maxZ: 256 },
      settings,
    );
    const right = generateRankedStoneInstances(
      { minX: 256, minZ: 0, maxX: 512, maxZ: 256 },
      settings,
    );
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

  it("fails closed when the injected shared authority is invalid", () => {
    const invalidSource: StoneEnvironmentSource = {
      sampleSite: () => null,
      sampleHeight: () => null,
    };

    expect(generateStoneInstances(footprint, settings, 100, undefined, invalidSource)).toEqual([]);
  });

  it("reuses one injected authority for site, cliff, and seating data", () => {
    let siteSamples = 0;
    let heightSamples = 0;
    const source: StoneEnvironmentSource = {
      sampleSite: () => {
        siteSamples += 1;
        return {
          height: 20,
          normalX: 0,
          normalY: 1,
          normalZ: 0,
          grass: 0.2,
          rock: 0.8,
          sand: 0,
          snow: 0,
          standingWater: false,
        };
      },
      sampleHeight: () => {
        heightSamples += 1;
        return 20;
      },
    };

    const instances = generateStoneInstances(
      { minX: 0, minZ: 0, maxX: 32, maxZ: 32 },
      { ...settings, density: 10 },
      10,
      undefined,
      source,
    );

    expect(instances.length).toBeGreaterThan(0);
    expect(siteSamples).toBeGreaterThan(0);
    expect(heightSamples).toBe(siteSamples * 2);
    expect(instances.every((stone) => stone.y <= 20)).toBe(true);
  });
});
