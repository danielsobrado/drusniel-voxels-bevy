import { describe, expect, it } from "vitest";
import {
  TREE_EXPANDED_SPECIES,
  expandedTreeSpeciesWeights,
  selectExpandedTreeSpecies,
  type TreeExpandedSpeciesSample,
} from "./index.js";

function sample(overrides: Partial<TreeExpandedSpeciesSample> = {}): TreeExpandedSpeciesSample {
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

describe("TREE-9 expanded species selection", () => {
  it("returns weighted choices for all six species when the sample is broadly viable", () => {
    const weights = expandedTreeSpeciesWeights(sample());

    expect(weights.map((entry) => entry.species)).toEqual([...TREE_EXPANDED_SPECIES]);
    expect(weights.every((entry) => entry.weight > 0)).toBe(true);
  });

  it("selects deterministically from cumulative weights", () => {
    const input = sample({ heightM: 14, moisture: 0.9, materialWeights: [0.55, 0.02, 0.43, 0] });
    const selectedA = selectExpandedTreeSpecies(input, 0.1);
    const selectedB = selectExpandedTreeSpecies(input, 0.1);

    expect(selectedA).toBe(selectedB);
    expect(selectedA).not.toBeNull();
  });

  it("can select every species with a roll sweep on a balanced sample", () => {
    const input = sample({ heightM: 30, moisture: 0.55, normalY: 0.8, materialWeights: [0.55, 0.2, 0.15, 0.1] });
    const selected = new Set<string>();

    for (let i = 0; i <= 200; i++) {
      const species = selectExpandedTreeSpecies(input, i / 200);
      if (species) selected.add(species);
    }

    expect(selected.size).toBeGreaterThanOrEqual(4);
    expect(selected.has("oak")).toBe(true);
    expect(selected.has("pine")).toBe(true);
  });

  it("clamps invalid or out-of-range rolls", () => {
    const input = sample();

    expect(selectExpandedTreeSpecies(input, Number.NaN)).toBe(selectExpandedTreeSpecies(input, 0));
    expect(selectExpandedTreeSpecies(input, -10)).toBe(selectExpandedTreeSpecies(input, 0));
    expect(selectExpandedTreeSpecies(input, 10)).toBe(selectExpandedTreeSpecies(input, 1));
  });
});
