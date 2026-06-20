import { describe, expect, it } from "vitest";
import type { PageFootprint } from "../types.js";
import {
  DEFAULT_TREE_SETTINGS,
  generateTreeInstances,
  parseTreeConfig,
  selectTreeSpecies,
  type TreeSettings,
  type TreeTerrainSampler,
} from "./index.js";
import treeYamlText from "../../config/trees.yaml?raw";

const footprint: PageFootprint = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
const sampler: TreeTerrainSampler = {
  surfaceHeight: () => 24,
  surfaceNormal: () => [0, 1, 0],
  materialWeights: () => [1, 0, 0, 0],
};
const settings: TreeSettings = {
  ...DEFAULT_TREE_SETTINGS,
  seed: 10,
  maxInstances: 1000,
  placement: {
    ...DEFAULT_TREE_SETTINGS.placement,
    spacingM: 4,
    jitter: 0.2,
    slopeMinY: 0,
    minHeightM: 0,
    maxHeightM: 80,
    minGroundWeight: 0.1,
    minSpacingM: 0,
  },
  species: {
    oak: { ...DEFAULT_TREE_SETTINGS.species.oak, minHeightM: 0, maxHeightM: 80 },
    pine: { ...DEFAULT_TREE_SETTINGS.species.pine, minHeightM: 0, maxHeightM: 80 },
    dead: { ...DEFAULT_TREE_SETTINGS.species.dead, minHeightM: 0, maxHeightM: 80 },
  },
};

describe("tree placement", () => {
  it("parses config/trees.yaml to the typed defaults", () => {
    expect(parseTreeConfig(treeYamlText, null)).toEqual(DEFAULT_TREE_SETTINGS);
  });

  it("is deterministic for the same footprint, seed, and config", () => {
    expect(generateTreeInstances(footprint, settings, settings.maxInstances, undefined, sampler, 32))
      .toEqual(generateTreeInstances(footprint, settings, settings.maxInstances, undefined, sampler, 32));
  });

  it("changes placement when the seed changes", () => {
    const first = generateTreeInstances(footprint, settings, settings.maxInstances, undefined, sampler, 32);
    const second = generateTreeInstances(footprint, { ...settings, seed: settings.seed + 1 }, settings.maxInstances, undefined, sampler, 32);
    expect(second).not.toEqual(first);
  });

  it("keeps generated positions inside the page footprint", () => {
    const trees = generateTreeInstances(footprint, settings, settings.maxInstances, undefined, sampler, 32);
    expect(trees.length).toBeGreaterThan(0);
    for (const tree of trees) {
      expect(tree.position[0]).toBeGreaterThanOrEqual(footprint.minX);
      expect(tree.position[0]).toBeLessThan(footprint.maxX);
      expect(tree.position[2]).toBeGreaterThanOrEqual(footprint.minZ);
      expect(tree.position[2]).toBeLessThan(footprint.maxZ);
    }
  });

  it("records slope, height, and material rejections", () => {
    const slopeStats = { generatedCandidates: 0, acceptedCandidates: 0, rejectedSlope: 0, rejectedHeight: 0, rejectedMaterial: 0 };
    generateTreeInstances(footprint, { ...settings, placement: { ...settings.placement, slopeMinY: 0.9 } }, 1000, slopeStats, {
      ...sampler,
      surfaceNormal: () => [0, 0.5, 0],
    }, 32);
    expect(slopeStats.rejectedSlope).toBe(slopeStats.generatedCandidates);

    const heightStats = { generatedCandidates: 0, acceptedCandidates: 0, rejectedSlope: 0, rejectedHeight: 0, rejectedMaterial: 0 };
    generateTreeInstances(footprint, { ...settings, placement: { ...settings.placement, minHeightM: 30 } }, 1000, heightStats, sampler, 32);
    expect(heightStats.rejectedHeight).toBe(heightStats.generatedCandidates);

    const materialStats = { generatedCandidates: 0, acceptedCandidates: 0, rejectedSlope: 0, rejectedHeight: 0, rejectedMaterial: 0 };
    generateTreeInstances(footprint, settings, 1000, materialStats, {
      ...sampler,
      materialWeights: () => [0, 0, 0, 1],
    }, 32);
    expect(materialStats.rejectedMaterial).toBe(materialStats.generatedCandidates);
  });

  it("selects species deterministically and respects enabled species", () => {
    expect(selectTreeSpecies(settings, 0.1)).toBe(selectTreeSpecies(settings, 0.1));
    const pineOnly = {
      ...settings,
      species: {
        oak: { ...settings.species.oak, enabled: false },
        pine: { ...settings.species.pine, enabled: true },
        dead: { ...settings.species.dead, enabled: false },
      },
    };
    const trees = generateTreeInstances(footprint, pineOnly, pineOnly.maxInstances, undefined, sampler, 32);
    expect(trees.length).toBeGreaterThan(0);
    expect(new Set(trees.map((tree) => tree.species))).toEqual(new Set(["pine"]));
  });

  it("keeps generated, accepted, and rejected counts coherent", () => {
    const stats = { generatedCandidates: 0, acceptedCandidates: 0, rejectedSlope: 0, rejectedHeight: 0, rejectedMaterial: 0 };
    const trees = generateTreeInstances(footprint, settings, settings.maxInstances, stats, sampler, 32);
    expect(stats.acceptedCandidates).toBe(trees.length);
    expect(stats.generatedCandidates).toBe(
      stats.acceptedCandidates + stats.rejectedSlope + stats.rejectedHeight + stats.rejectedMaterial,
    );
  });
});
