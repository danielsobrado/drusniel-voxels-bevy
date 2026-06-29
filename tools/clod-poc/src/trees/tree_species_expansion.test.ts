import { describe, expect, it } from "vitest";
import {
  TREE_EXPANDED_SPECIES,
  TREE_EXPANDED_SPECIES_DEFAULTS,
  TREE_EXPANDED_SPECIES_NICHES,
  TREE_RING_SHADOW_CASCADE_COUNT,
  TREE_SPECIES,
  cloneTreeSettings,
  generateTreeInstances,
  treeExpandedSpeciesNicheWeight,
  type TreeExpandedSpeciesSample,
  type TreeTerrainSampler,
} from "./index.js";
import {
  TREE_GPU_RING_GROUP_COUNT,
  TREE_GPU_RING_SHADOW_GROUP_COUNT,
  treeGpuRingGroupIndex,
} from "../gpu/tree_ring_compute.js";
import { treeRingSpeciesLayout } from "../gpu/tree_ring_species_layout.js";

describe("TREE-9 six-species expansion contract", () => {
  it("defines exactly six species with defaults and niches", () => {
    expect(TREE_EXPANDED_SPECIES).toEqual(["oak", "pine", "dead", "birch", "willow", "spruce"]);
    expect(TREE_SPECIES).toEqual(TREE_EXPANDED_SPECIES);
    for (const species of TREE_EXPANDED_SPECIES) {
      expect(TREE_EXPANDED_SPECIES_DEFAULTS[species].enabled).toBe(true);
      expect(TREE_EXPANDED_SPECIES_DEFAULTS[species].weight).toBeGreaterThan(0);
      expect(TREE_EXPANDED_SPECIES_NICHES[species].materialBias).toHaveLength(4);
    }
  });

  it("uses a 6 species x 4 LOD GPU ring layout", () => {
    expect(TREE_GPU_RING_GROUP_COUNT).toBe(6 * 4);
    expect(TREE_GPU_RING_SHADOW_GROUP_COUNT).toBe(6 * 4 * TREE_RING_SHADOW_CASCADE_COUNT);

    const layout = treeRingSpeciesLayout(TREE_SPECIES.length, TREE_RING_SHADOW_CASCADE_COUNT);
    expect(layout.groupCount).toBe(24);
    expect(layout.shadowGroupCount).toBe(24 * TREE_RING_SHADOW_CASCADE_COUNT);
    expect(treeGpuRingGroupIndex("spruce", "impostor")).toBe(23);
  });

  it("keeps each new species morphologically distinct", () => {
    const defaults = TREE_EXPANDED_SPECIES_DEFAULTS;

    expect(defaults.willow.crownRadiusM).toBeGreaterThan(defaults.birch.crownRadiusM);
    expect(defaults.spruce.trunkHeightM).toBeGreaterThan(defaults.pine.trunkHeightM);
    expect(defaults.birch.morphology.crownFlattening).toBeLessThan(defaults.spruce.morphology.crownFlattening);
    expect(defaults.dead.morphology.leafClusterCount).toBe(0);
  });

  it("prefers willow in wet lowland banks", () => {
    const wetBank = sample({ heightM: 12, moisture: 0.9, normalY: 0.96, materialWeights: [0.45, 0.02, 0.53, 0] });

    const willow = treeExpandedSpeciesNicheWeight("willow", wetBank);
    expect(willow).toBeGreaterThan(treeExpandedSpeciesNicheWeight("pine", wetBank));
    expect(willow).toBeGreaterThan(treeExpandedSpeciesNicheWeight("spruce", wetBank));
  });

  it("prefers spruce over oak in high cold rocky slopes", () => {
    const highSlope = sample({ heightM: 58, moisture: 0.42, normalY: 0.78, materialWeights: [0.18, 0.52, 0, 0.30] });

    const spruce = treeExpandedSpeciesNicheWeight("spruce", highSlope);
    expect(spruce).toBeGreaterThan(treeExpandedSpeciesNicheWeight("oak", highSlope));
    expect(spruce).toBeGreaterThan(treeExpandedSpeciesNicheWeight("willow", highSlope));
  });

  it("prefers dead trees in old stressed forest", () => {
    const oldRock = sample({ heightM: 44, moisture: 0.45, normalY: 0.72, age: "old", forestDensity: 0.9, materialWeights: [0.15, 0.70, 0, 0.15] });

    const dead = treeExpandedSpeciesNicheWeight("dead", oldRock);
    expect(dead).toBeGreaterThan(treeExpandedSpeciesNicheWeight("birch", oldRock));
    expect(dead).toBeGreaterThan(treeExpandedSpeciesNicheWeight("willow", oldRock));
  });

  it("can generate every expanded species through the runtime instance path", () => {
    const seen = new Set<string>();
    for (const species of TREE_SPECIES) {
      const settings = cloneTreeSettings();
      for (const candidate of TREE_SPECIES) settings.species[candidate].weight = candidate === species ? 1 : 0;
      settings.ecology.enabled = false;
      settings.placement.spacingM = 4;
      settings.placement.minSpacingM = 0;
      settings.placement.minGroundWeight = 0;
      settings.placement.slopeMinY = 0;
      settings.placement.minHeightM = 0;
      settings.placement.maxHeightM = 80;
      settings.maxInstances = 16;

      const instances = generateTreeInstances(
        { minX: 0, minZ: 0, maxX: 32, maxZ: 32 },
        settings,
        16,
        undefined,
        flatSampler(24),
        32,
      );
      expect(instances.some((instance) => instance.species === species)).toBe(true);
      for (const instance of instances) seen.add(instance.species);
    }

    expect([...seen].sort()).toEqual([...TREE_SPECIES].sort());
  });
});

function sample(overrides: Partial<TreeExpandedSpeciesSample>): TreeExpandedSpeciesSample {
  return {
    heightM: 24,
    normalY: 0.9,
    moisture: 0.55,
    clusterMask: 0.4,
    age: "mature",
    forestDensity: 0.7,
    materialWeights: [1, 0, 0, 0],
    lowlandHeightM: 16,
    highlandHeightM: 42,
    ...overrides,
  };
}

function flatSampler(height: number): TreeTerrainSampler {
  return {
    surfaceHeight: () => height,
    surfaceNormal: () => [0, 1, 0],
    materialWeights: () => [1, 0, 0, 0],
  };
}
