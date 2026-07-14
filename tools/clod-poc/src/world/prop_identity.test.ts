import { describe, expect, it } from "vitest";
import {
  candidateAddressForWorldPosition,
  deriveEnvironmentalPropId,
  enumerateStoneCandidatesForTile,
  enumerateTreeCandidatesForTile,
} from "./prop_identity.js";

describe("environmental prop identity", () => {
  it("is stable, seed/world specific, and unique within a tile", () => {
    const candidates = enumerateTreeCandidatesForTile({ x: -2, z: 3 }, 16);
    const ids = candidates.map((candidate) => deriveEnvironmentalPropId("world:seed-7", candidate));
    expect(ids).toEqual(candidates.map((candidate) => deriveEnvironmentalPropId("world:seed-7", candidate)));
    expect(new Set(ids).size).toBe(ids.length);
    expect(deriveEnvironmentalPropId("world:seed-8", candidates[0]!)).not.toBe(ids[0]);
  });

  it("re-derives the same address after tile candidate eviction", () => {
    const before = candidateAddressForWorldPosition("stone", -0.25, 256.25, 4);
    void enumerateStoneCandidatesForTile(before.tileKey, 4);
    const after = candidateAddressForWorldPosition("stone", -0.25, 256.25, 4);
    expect(after).toEqual(before);
    expect(deriveEnvironmentalPropId("world", after)).toBe(deriveEnvironmentalPropId("world", before));
  });
});
