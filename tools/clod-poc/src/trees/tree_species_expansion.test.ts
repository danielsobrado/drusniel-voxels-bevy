import { describe, expect, it } from "vitest";
import {
  TREE_EXPANDED_SPECIES,
  TREE_EXPANDED_SPECIES_DEFAULTS,
  TREE_EXPANDED_SPECIES_NICHES,
  treeExpandedSpeciesNicheWeight,
  type TreeExpandedSpeciesSample,
} from "./index.js";

describe("TREE-9 six-species expansion contract", () => {
  it("defines exactly six species with defaults and niches", () => {
    expect(TREE_EXPANDED_SPECIES).toEqual(["oak", "pine", "dead", "birch", "willow", "spruce"]);
    for (const species of TREE_EXPANDED_SPECIES) {
      expect(TREE_EXPANDED_SPECIES_DEFAULTS[species].enabled).toBe(true);
      expect(TREE_EXPANDED_SPECIES_DEFAULTS[species].weight).toBeGreaterThan(0);
      expect(TREE_EXPANDED_SPECIES_NICHES[species].materialBias).toHaveLength(4);
    }
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
