import { describe, expect, it } from "vitest";
import type { PageFootprint } from "../types.js";
import {
  cloneUnderstorySettings,
  DEFAULT_UNDERSTORY_SETTINGS,
  generateUnderstoryInstances,
  sampleUnderstoryEcology,
  understoryClassWeight,
  emptyUnderstoryGenerationStats,
  type UnderstorySettings,
  type UnderstoryTerrainSampler,
} from "./index.js";

const footprint: PageFootprint = { minX: 0, minZ: 0, maxX: 64, maxZ: 64 };

function testSettings(seed = 123): UnderstorySettings {
  const settings = cloneUnderstorySettings(DEFAULT_UNDERSTORY_SETTINGS);
  settings.seed = seed;
  settings.maxInstances = 10000;
  settings.placement.spacingM = 4;
  settings.placement.jitter = 0.25;
  settings.placement.slopeMinY = 0;
  settings.placement.minHeightM = 0;
  settings.placement.maxHeightM = 128;
  settings.placement.minGroundWeight = 0;
  settings.placement.minTreeInfluence = 0;
  return settings;
}

function sampler(height = 24, normalY = 1, groundWeight = 1): UnderstoryTerrainSampler {
  return {
    surfaceHeight: () => height,
    surfaceNormal: () => [0, normalY, 0],
    materialWeights: () => [groundWeight, 0, 0, 0],
  };
}

describe("understory ecology", () => {
  it("is deterministic, seed-sensitive, finite, and bounded", () => {
    const a = sampleUnderstoryEcology(12.5, 20.25, 24, 0.9, 1, testSettings(1));
    expect(a).toEqual(sampleUnderstoryEcology(12.5, 20.25, 24, 0.9, 1, testSettings(1)));
    expect(a).not.toEqual(sampleUnderstoryEcology(12.5, 20.25, 24, 0.9, 1, testSettings(2)));
    for (const value of Object.values(a)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("weights classes by ecology preferences", () => {
    const settings = testSettings();
    const dampShade = { forestInfluence: 1, forestEdge: 0.1, shade: 1, moisture: 1, clearing: 0, density: 1, deadfall: 0.2 };
    const clearingEdge = { forestInfluence: 0.35, forestEdge: 1, shade: 0.1, moisture: 0.45, clearing: 1, density: 1, deadfall: 0.1 };
    const deadfall = { forestInfluence: 1, forestEdge: 0.1, shade: 0.8, moisture: 0.55, clearing: 0.1, density: 1, deadfall: 1 };
    expect(understoryClassWeight("fern", dampShade, 18, 1, settings))
      .toBeGreaterThan(understoryClassWeight("flower", dampShade, 18, 1, settings));
    expect(understoryClassWeight("flower", clearingEdge, 18, 1, settings))
      .toBeGreaterThan(understoryClassWeight("fern", clearingEdge, 18, 1, settings));
    expect(understoryClassWeight("dead_log", deadfall, 18, 1, settings))
      .toBeGreaterThan(understoryClassWeight("dead_log", clearingEdge, 18, 1, settings));
    settings.classes.fern.enabled = false;
    expect(understoryClassWeight("fern", dampShade, 18, 1, settings)).toBe(0);
  });
});

describe("understory placement", () => {
  it("is deterministic and seed-sensitive", () => {
    const first = generateUnderstoryInstances(footprint, testSettings(5), 10000, undefined, sampler(), 64);
    const second = generateUnderstoryInstances(footprint, testSettings(5), 10000, undefined, sampler(), 64);
    const changed = generateUnderstoryInstances(footprint, testSettings(6), 10000, undefined, sampler(), 64);
    expect(first).toEqual(second);
    expect(first).not.toEqual(changed);
  });

  it("keeps positions inside the footprint", () => {
    const instances = generateUnderstoryInstances(footprint, testSettings(), 10000, undefined, sampler(), 64);
    expect(instances.length).toBeGreaterThan(0);
    for (const instance of instances) {
      expect(instance.position[0]).toBeGreaterThanOrEqual(footprint.minX);
      expect(instance.position[0]).toBeLessThanOrEqual(footprint.maxX);
      expect(instance.position[2]).toBeGreaterThanOrEqual(footprint.minZ);
      expect(instance.position[2]).toBeLessThanOrEqual(footprint.maxZ);
    }
  });

  it("records coherent hard rejection stats", () => {
    const settings = testSettings();
    settings.placement.slopeMinY = 0.9;
    const slopeStats = emptyUnderstoryGenerationStats();
    expect(generateUnderstoryInstances(footprint, settings, 10000, slopeStats, sampler(24, 0.2), 64)).toHaveLength(0);
    expect(slopeStats.rejectedSlope).toBe(slopeStats.generatedCandidates);

    settings.placement.slopeMinY = 0;
    settings.placement.minHeightM = 50;
    const heightStats = emptyUnderstoryGenerationStats();
    expect(generateUnderstoryInstances(footprint, settings, 10000, heightStats, sampler(24), 64)).toHaveLength(0);
    expect(heightStats.rejectedHeight).toBe(heightStats.generatedCandidates);

    settings.placement.minHeightM = 0;
    settings.placement.minGroundWeight = 0.5;
    const materialStats = emptyUnderstoryGenerationStats();
    expect(generateUnderstoryInstances(footprint, settings, 10000, materialStats, sampler(24, 1, 0), 64)).toHaveLength(0);
    expect(materialStats.rejectedMaterial).toBe(materialStats.generatedCandidates);
  });

  it("prevents exact overlaps and keeps logs rarer than foliage", () => {
    const settings = testSettings();
    settings.classes.dead_log.weight = 5;
    const instances = generateUnderstoryInstances(footprint, settings, 10000, undefined, sampler(), 64);
    const keys = new Set(instances.map((instance) => `${instance.position[0].toFixed(4)}:${instance.position[2].toFixed(4)}`));
    expect(keys.size).toBe(instances.length);
    expect(instances.filter((instance) => instance.classId === "dead_log").length).toBeLessThan(instances.length);
  });
});
