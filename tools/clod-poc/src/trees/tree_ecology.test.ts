import { describe, expect, it } from "vitest";
import type { PageFootprint } from "../types.js";
import {
  cloneTreeSettings,
  DEFAULT_TREE_SETTINGS,
  generateTreeInstances,
  sampleTreeEcology,
  speciesEcologyWeight,
  type TreeSettings,
  type TreeTerrainSampler,
} from "./index.js";

const footprint: PageFootprint = { minX: 0, minZ: 0, maxX: 128, maxZ: 128 };

function sampler(height: number, normalY = 1, groundWeight = 1): TreeTerrainSampler {
  return {
    surfaceHeight: () => height,
    surfaceNormal: () => [0, normalY, 0],
    materialWeights: () => [groundWeight, 0, 0, 0],
  };
}

function ecologySettings(overrides: Partial<TreeSettings> = {}): TreeSettings {
  const settings = cloneTreeSettings(DEFAULT_TREE_SETTINGS);
  settings.seed = 1234;
  settings.maxInstances = 10000;
  settings.placement = {
    ...settings.placement,
    spacingM: 8,
    jitter: 0.18,
    slopeMinY: 0,
    minHeightM: 0,
    maxHeightM: 128,
    minGroundWeight: 0,
    minSpacingM: 0,
  };
  settings.species.oak.minHeightM = 0;
  settings.species.oak.maxHeightM = 128;
  settings.species.pine.minHeightM = 0;
  settings.species.pine.maxHeightM = 128;
  settings.species.dead.minHeightM = 0;
  settings.species.dead.maxHeightM = 128;
  settings.ecology.density.forestNoiseStrength = 0;
  settings.ecology.density.clearingThreshold = 1;
  settings.ecology.clustering.clusterStrength = 0;
  return { ...settings, ...overrides };
}

describe("tree ecology sampling", () => {
  it("is deterministic for the same point and seed", () => {
    const settings = ecologySettings();
    expect(sampleTreeEcology(12.5, 44.25, 24, 0.9, 1, settings))
      .toEqual(sampleTreeEcology(12.5, 44.25, 24, 0.9, 1, settings));
  });

  it("changes when the seed changes", () => {
    const first = sampleTreeEcology(12.5, 44.25, 24, 0.9, 1, ecologySettings({ seed: 1 }));
    const second = sampleTreeEcology(12.5, 44.25, 24, 0.9, 1, ecologySettings({ seed: 2 }));
    expect([
      first.forestDensity,
      first.clearingMask,
      first.clusterMask,
      first.moisture,
      first.scaleMultiplier,
    ]).not.toEqual([
      second.forestDensity,
      second.clearingMask,
      second.clusterMask,
      second.moisture,
      second.scaleMultiplier,
    ]);
  });

  it("varies smoothly nearby and differs at distant points", () => {
    const settings = ecologySettings();
    const nearbyA = sampleTreeEcology(20, 20, 24, 1, 1, settings);
    const nearbyB = sampleTreeEcology(22, 21, 24, 1, 1, settings);
    const distant = sampleTreeEcology(420, 380, 24, 1, 1, settings);
    expect(Math.abs(nearbyA.moisture - nearbyB.moisture)).toBeLessThan(0.25);
    expect(Math.abs(nearbyA.moisture - distant.moisture)).toBeGreaterThan(0.01);
  });

  it("keeps ecology sample fields in bounds", () => {
    const settings = ecologySettings();
    for (let z = 0; z < 128; z += 11) {
      for (let x = 0; x < 128; x += 13) {
        const sample = sampleTreeEcology(x, z, 18 + x * 0.1, 0.74 + (z % 17) * 0.01, 0.7, settings);
        expect(sample.forestDensity).toBeGreaterThanOrEqual(0);
        expect(sample.forestDensity).toBeLessThanOrEqual(1);
        expect(sample.clearingMask).toBeGreaterThanOrEqual(0);
        expect(sample.clearingMask).toBeLessThanOrEqual(1);
        expect(sample.clusterMask).toBeGreaterThanOrEqual(0);
        expect(sample.clusterMask).toBeLessThanOrEqual(1);
        expect(sample.terrainSuitability).toBeGreaterThanOrEqual(0);
        expect(sample.terrainSuitability).toBeLessThanOrEqual(1);
        expect(sample.moisture).toBeGreaterThanOrEqual(0);
        expect(sample.moisture).toBeLessThanOrEqual(1);
        expect(Number.isFinite(sample.scaleMultiplier)).toBe(true);
        expect(sample.scaleMultiplier).toBeGreaterThan(0);
      }
    }
  });
});

describe("tree ecology placement", () => {
  it("ignores ecology density fields when ecology is disabled", () => {
    const base = ecologySettings();
    base.ecology.enabled = false;
    const changed = cloneTreeSettings(base);
    changed.ecology.density.baseDensity = 0;
    changed.ecology.density.clearingThreshold = 0;
    changed.ecology.clustering.clusterStrength = 1;
    expect(generateTreeInstances(footprint, base, 10000, undefined, sampler(24), 128))
      .toEqual(generateTreeInstances(footprint, changed, 10000, undefined, sampler(24), 128));
  });

  it("rejects candidates in clearing-heavy ecology", () => {
    const settings = ecologySettings();
    const open = cloneTreeSettings(settings);
    open.ecology.density.clearingThreshold = 0;
    open.ecology.density.clearingSoftness = 0.001;
    const wooded = cloneTreeSettings(settings);
    wooded.ecology.density.clearingThreshold = 1;
    expect(generateTreeInstances(footprint, open, 10000, undefined, sampler(24), 128).length)
      .toBeLessThan(generateTreeInstances(footprint, wooded, 10000, undefined, sampler(24), 128).length);
  });

  it("responds to base density", () => {
    const low = ecologySettings();
    low.ecology.density.baseDensity = 0.2;
    const high = cloneTreeSettings(low);
    high.ecology.density.baseDensity = 2;
    expect(generateTreeInstances(footprint, high, 10000, undefined, sampler(24), 128).length)
      .toBeGreaterThan(generateTreeInstances(footprint, low, 10000, undefined, sampler(24), 128).length);
  });

  it("favors oak in lowland and pine in higher terrain", () => {
    const settings = ecologySettings();
    settings.species.oak.weight = 1;
    settings.species.pine.weight = 1;
    settings.species.dead.enabled = false;
    const low = speciesCounts(generateTreeInstances(footprint, settings, 10000, undefined, sampler(18), 128));
    const high = speciesCounts(generateTreeInstances(footprint, settings, 10000, undefined, sampler(36), 128));
    expect(low.oak).toBeGreaterThan(low.pine);
    expect(high.pine).toBeGreaterThan(high.oak);
  });

  it("boosts dead species in old dense forest samples", () => {
    const settings = ecologySettings();
    const mature = sampleTreeEcology(8, 8, 24, 1, 1, settings);
    const oldDense = { ...mature, age: "old" as const, forestDensity: 1, clusterMask: 1 };
    expect(speciesEcologyWeight("dead", oldDense, 24, 1, settings))
      .toBeGreaterThan(speciesEcologyWeight("dead", mature, 24, 1, settings));
  });

  it("never selects disabled species", () => {
    const settings = ecologySettings();
    settings.species.oak.enabled = false;
    settings.species.dead.enabled = false;
    const trees = generateTreeInstances(footprint, settings, 10000, undefined, sampler(36), 128);
    expect(trees.length).toBeGreaterThan(0);
    expect(new Set(trees.map((tree) => tree.species))).toEqual(new Set(["pine"]));
  });

  it("clusters accepted trees when cluster strength is high", () => {
    const unclustered = ecologySettings();
    unclustered.ecology.density.baseDensity = 2;
    unclustered.ecology.clustering.clusterStrength = 0;
    const clustered = cloneTreeSettings(unclustered);
    clustered.ecology.clustering.clusterStrength = 1;
    clustered.ecology.clustering.clusterThreshold = 0.52;
    const looseVariance = occupancyVariance(generateTreeInstances(footprint, unclustered, 10000, undefined, sampler(24), 128), 4);
    const clusteredVariance = occupancyVariance(generateTreeInstances(footprint, clustered, 10000, undefined, sampler(24), 128), 4);
    expect(clusteredVariance).toBeGreaterThanOrEqual(looseVariance);
  });

  it("keeps scales finite and age settings affect average scale", () => {
    const young = ecologySettings();
    young.ecology.age.youngProbability = 1;
    young.ecology.age.oldProbability = 0;
    const old = cloneTreeSettings(young);
    old.ecology.age.youngProbability = 0;
    old.ecology.age.oldProbability = 1;
    const youngTrees = generateTreeInstances(footprint, young, 10000, undefined, sampler(24), 128);
    const oldTrees = generateTreeInstances(footprint, old, 10000, undefined, sampler(24), 128);
    expect(youngTrees.every((tree) => Number.isFinite(tree.scale) && tree.scale > 0)).toBe(true);
    expect(oldTrees.some((tree) => tree.scale > 1)).toBe(true);
    expect(averageScale(oldTrees)).toBeGreaterThan(averageScale(youngTrees));
  });

  it("keeps generated candidate count bounded by page grid", () => {
    const settings = ecologySettings();
    const stats = {
      generatedCandidates: 0,
      acceptedCandidates: 0,
      rejectedSlope: 0,
      rejectedHeight: 0,
      rejectedMaterial: 0,
    };
    generateTreeInstances(footprint, settings, 10000, stats, sampler(24), 128);
    expect(stats.generatedCandidates).toBe(16 * 16);
    expect(stats.generatedCandidates).toBe(
      stats.acceptedCandidates + stats.rejectedSlope + stats.rejectedHeight + stats.rejectedMaterial,
    );
  });
});

function speciesCounts(trees: ReturnType<typeof generateTreeInstances>) {
  return trees.reduce((counts, tree) => {
    counts[tree.species]++;
    return counts;
  }, { oak: 0, pine: 0, dead: 0 });
}

function occupancyVariance(trees: ReturnType<typeof generateTreeInstances>, cellsPerAxis: number): number {
  const cells = new Array(cellsPerAxis * cellsPerAxis).fill(0) as number[];
  for (const tree of trees) {
    const x = Math.min(cellsPerAxis - 1, Math.floor((tree.position[0] / footprint.maxX) * cellsPerAxis));
    const z = Math.min(cellsPerAxis - 1, Math.floor((tree.position[2] / footprint.maxZ) * cellsPerAxis));
    cells[z * cellsPerAxis + x]++;
  }
  const mean = cells.reduce((sum, value) => sum + value, 0) / cells.length;
  return cells.reduce((sum, value) => sum + (value - mean) ** 2, 0) / cells.length;
}

function averageScale(trees: ReturnType<typeof generateTreeInstances>): number {
  return trees.reduce((sum, tree) => sum + tree.scale, 0) / Math.max(1, trees.length);
}
