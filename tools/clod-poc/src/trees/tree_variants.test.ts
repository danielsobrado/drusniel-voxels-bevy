import { describe, expect, it } from "vitest";
import type { PageFootprint } from "../types.js";
import {
  DEFAULT_TREE_SETTINGS,
  generateTreeInstances,
  TREE_STRUCTURAL_VARIANTS,
  type TreeSettings,
  type TreeTerrainSampler,
} from "./index.js";

const footprint: PageFootprint = { minX: 0, minZ: 0, maxX: 32, maxZ: 32 };
const sampler: TreeTerrainSampler = {
  surfaceHeight: () => 24,
  surfaceNormal: () => [0, 1, 0],
  materialWeights: () => [1, 0, 0, 0],
};
const settings: TreeSettings = {
  ...DEFAULT_TREE_SETTINGS,
  seed: 77,
  maxInstances: 1000,
  ecology: { ...DEFAULT_TREE_SETTINGS.ecology, enabled: false },
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

describe("tree structural variants", () => {
  it("assigns deterministic variants in range", () => {
    const first = generateTreeInstances(footprint, settings, settings.maxInstances, undefined, sampler, 32);
    const second = generateTreeInstances(footprint, settings, settings.maxInstances, undefined, sampler, 32);

    expect(first.length).toBeGreaterThan(0);
    expect(first.map((tree) => tree.variant)).toEqual(second.map((tree) => tree.variant));
    for (const tree of first) {
      expect(Number.isInteger(tree.variant)).toBe(true);
      expect(tree.variant).toBeGreaterThanOrEqual(0);
      expect(tree.variant).toBeLessThan(TREE_STRUCTURAL_VARIANTS);
    }
  });

  it("changes distribution when the seed changes", () => {
    const first = generateTreeInstances(footprint, settings, settings.maxInstances, undefined, sampler, 32);
    const changed = generateTreeInstances(
      footprint,
      { ...settings, seed: settings.seed + 1 },
      settings.maxInstances,
      undefined,
      sampler,
      32,
    );

    expect(changed.map((tree) => tree.variant)).not.toEqual(first.map((tree) => tree.variant));
  });
});
