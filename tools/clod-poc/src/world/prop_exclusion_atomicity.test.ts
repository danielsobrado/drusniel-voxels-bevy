import { describe, expect, it } from "vitest";
import type { SavedPropInstance } from "../save/save_schema.js";
import type { PropCandidateAddress } from "./prop_identity.js";
import { SparsePropExclusionBitsets } from "./prop_exclusion.js";

const ADDRESS: PropCandidateAddress = {
  tileKey: { x: 2, z: -1 },
  layer: "tree",
  candidateIndex: 7,
};

function prop(state: SavedPropInstance["state"]): SavedPropInstance {
  return {
    id: "env-7",
    prefabId: "environment/tree",
    position: [1, 0, 1],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    regionKey: "r_0_0",
    state,
    tags: ["environmental"],
    environmental: ADDRESS,
  };
}

function expectEmpty(exclusions: SparsePropExclusionBitsets): void {
  expect(exclusions.counters()).toEqual({ prop_delta_count: 0, prop_exclusion_tiles: 0 });
  expect(exclusions.isExcluded(ADDRESS)).toBe(false);
  expect(exclusions.gpuWords(ADDRESS.tileKey, ADDRESS.layer)).toBeNull();
  expect(exclusions.consumeDirtyTileLayers()).toEqual([]);
}

describe("SparsePropExclusionBitsets rejected mutation atomicity", () => {
  it("leaves state unchanged when removal underflows", () => {
    const exclusions = new SparsePropExclusionBitsets();

    expect(() => exclusions.applyDelta(prop("destroyed"), null)).toThrow(/underflow/);
    expectEmpty(exclusions);
  });

  it("rejects a same-address update when the previous exclusion is absent", () => {
    const exclusions = new SparsePropExclusionBitsets();

    expect(() => exclusions.applyDelta(prop("destroyed"), prop("hidden"))).toThrow(/underflow/);
    expectEmpty(exclusions);
  });

  it("remains usable after a rejected mutation", () => {
    const exclusions = new SparsePropExclusionBitsets();
    expect(() => exclusions.applyDelta(prop("destroyed"), null)).toThrow(/underflow/);

    exclusions.applyDelta(null, prop("destroyed"));

    expect(exclusions.isExcluded(ADDRESS)).toBe(true);
    expect(exclusions.counters()).toEqual({ prop_delta_count: 1, prop_exclusion_tiles: 1 });
  });
});
