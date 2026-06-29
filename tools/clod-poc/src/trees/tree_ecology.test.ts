import { describe, expect, it } from "vitest";
import type { PageFootprint } from "../types.js";
import {
  cloneTreeSettings,
  DEFAULT_TREE_SETTINGS,
  generateTreeInstances,
  sampleTreeEcology,
  speciesEcologyWeight,
  TREE_SPECIES,
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
  for (const species of TREE_SPECIES) {
    settings.species[species].minHeightM = 0;
    settings.species[species].maxHeightM = 128;
  }
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

  it("weights species by ecological niche", () => {
    const settings = ecologySettings();
    const lowland = sampleTreeEcology(0, 0, 18, 0.95, 1, settings);
    const highland = sampleTreeEcology(0, 0, 52, 0.95, 1, settings);

    expect(speciesEcologyWeight("oak", lowland, settings)).toBeGreaterThan(speciesEcologyWeight("oak", highland, settings));
    expect(speciesEcologyWeight("pine", highland, settings)).toBeGreaterThan(speciesEcologyWeight("pine", lowland, settings));
  });

  it("scales generated trees by age ecology", () => {
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
  const counts = Object.fromEntries(TREE_SPECIES.map((species) => [species, 0])) as Record<typeof TREE_SPECIES[number], number>;
  return trees.reduce((next, tree) => {
    next[tree.species]++;
    return next;
  }, counts);
}

function occupancyVariance(trees: ReturnType<typeof generateTreeInstances>, cellsPerAxis: number): number {
  const cells = new Array(cellsPerAxis * cellsPerAxis).fill(0) as number[];
  for (const tree of trees) {
    const x = Math.min(cellsPerAxis - 1, Math.floor((tree.position[0] / footprint.maxX) * cellsPerAxis));
    const z = Math.min(cellsPerAxis - 1, Math.floor((tree.position[2] / footprint.maxZ) * cellsPerAxis));
    cells[z * cellsPerAxis + x]++;
  }
  const mean = cells.reduce((sum, value) => sum + value, 0) / cells.length;
  return cells.reduce((sum, tree) => sum + (tree - mean) ** 2, 0) / cells.length;
}

function averageScale(trees: ReturnType<typeof generateTreeInstances>): number {
  return trees.reduce((sum, tree) => sum + tree.scale, 0) / Math.max(1, trees.length);
}
