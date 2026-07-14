import { describe, expect, it } from "vitest";
import type { SavedPropInstance } from "../save/save_schema.js";
import { SparsePropExclusionBitsets } from "./prop_exclusion.js";

function delta(candidateIndex: number): SavedPropInstance {
  return {
    id: `env_${candidateIndex}`,
    prefabId: "environment/tree",
    position: [1, 0, 1], rotation: [0, 0, 0, 1], scale: [1, 1, 1],
    regionKey: "r_0_0", state: "destroyed", tags: ["environmental"],
    environmental: { tileKey: { x: 0, z: 0 }, layer: "tree", candidateIndex },
  };
}

describe("sparse prop exclusions", () => {
  it("round-trips destroyed candidates into sparse GPU words", () => {
    const exclusions = SparsePropExclusionBitsets.fromSavedProps([delta(0), delta(35)]);
    expect(exclusions.isExcluded(delta(0).environmental!)).toBe(true);
    expect(exclusions.isExcluded(delta(1).environmental!)).toBe(false);
    expect([...exclusions.gpuWords({ x: 0, z: 0 }, "tree")!]).toEqual([1, 8]);
    expect(exclusions.counters()).toEqual({ prop_delta_count: 2, prop_exclusion_tiles: 1 });
  });
});
