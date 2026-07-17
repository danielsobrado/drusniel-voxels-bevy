import { describe, expect, it } from "vitest";
import type { SavedPropInstance } from "../save/save_schema.js";
import type { PropCandidateAddress } from "./prop_identity.js";
import { SparsePropExclusionBitsets } from "./prop_exclusion.js";

function address(candidateIndex: number, tileX = 0, tileZ = 0): PropCandidateAddress {
  return { tileKey: { x: tileX, z: tileZ }, layer: "tree", candidateIndex };
}

function envProp(
  id: string,
  candidate: PropCandidateAddress,
  state: SavedPropInstance["state"] = "destroyed",
): SavedPropInstance {
  return {
    id,
    prefabId: "environment/tree",
    position: [1, 0, 1], rotation: [0, 0, 0, 1], scale: [1, 1, 1],
    regionKey: "r_0_0", state, tags: ["environmental"],
    environmental: candidate,
  };
}

function delta(candidateIndex: number): SavedPropInstance {
  return envProp(`env_${candidateIndex}`, address(candidateIndex));
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

describe("incremental prop exclusion contract", () => {
  it("active→destroyed sets the exclusion bit", () => {
    const exclusions = new SparsePropExclusionBitsets();
    exclusions.applyDelta(null, envProp("a", address(3), "active"));
    expect(exclusions.isExcluded(address(3))).toBe(false);
    exclusions.applyDelta(envProp("a", address(3), "active"), envProp("a", address(3), "destroyed"));
    expect(exclusions.isExcluded(address(3))).toBe(true);
    expect(exclusions.counters().prop_delta_count).toBe(1);
  });

  it("destroyed→restored clears the exclusion bit", () => {
    const exclusions = SparsePropExclusionBitsets.fromSavedProps([envProp("a", address(3))]);
    exclusions.applyDelta(envProp("a", address(3), "destroyed"), envProp("a", address(3), "active"));
    expect(exclusions.isExcluded(address(3))).toBe(false);
    expect(exclusions.counters().prop_delta_count).toBe(1);
  });

  it("environmental address change clears the old candidate and sets the new", () => {
    const exclusions = SparsePropExclusionBitsets.fromSavedProps([envProp("a", address(3))]);
    exclusions.applyDelta(envProp("a", address(3)), envProp("a", address(64, 1, 0)));
    expect(exclusions.isExcluded(address(3))).toBe(false);
    expect(exclusions.isExcluded(address(64, 1, 0))).toBe(true);
    expect(exclusions.counters().prop_delta_count).toBe(1);
  });

  it("removal of a destroyed environmental prop clears its bit and its counters", () => {
    const exclusions = SparsePropExclusionBitsets.fromSavedProps([envProp("a", address(3))]);
    exclusions.applyDelta(envProp("a", address(3)), null);
    expect(exclusions.isExcluded(address(3))).toBe(false);
    expect(exclusions.counters()).toEqual({ prop_delta_count: 0, prop_exclusion_tiles: 0 });
    expect(exclusions.gpuWords({ x: 0, z: 0 }, "tree")).toBeNull();
  });

  it("duplicate references to one candidate are refcounted, not clobbered", () => {
    const exclusions = SparsePropExclusionBitsets.fromSavedProps([
      envProp("a", address(3)),
      envProp("b", address(3)),
    ]);
    expect(exclusions.isExcluded(address(3))).toBe(true);
    exclusions.applyDelta(envProp("a", address(3), "destroyed"), envProp("a", address(3), "active"));
    expect(exclusions.isExcluded(address(3))).toBe(true);
    exclusions.applyDelta(envProp("b", address(3), "destroyed"), envProp("b", address(3), "active"));
    expect(exclusions.isExcluded(address(3))).toBe(false);
  });

  it("throws on refcount underflow instead of silently corrupting", () => {
    const exclusions = new SparsePropExclusionBitsets();
    expect(() => exclusions.applyDelta(envProp("a", address(3), "destroyed"), null)).toThrow(/underflow/);
  });

  it("setExcluded is a set-AND-clear candidate primitive", () => {
    const exclusions = new SparsePropExclusionBitsets();
    exclusions.setExcluded(address(40), true);
    expect(exclusions.isExcluded(address(40))).toBe(true);
    exclusions.setExcluded(address(40), false);
    expect(exclusions.isExcluded(address(40))).toBe(false);
    expect(exclusions.counters().prop_exclusion_tiles).toBe(0);
  });

  it("keeps prop_delta_count parity with fromSavedProps after any sequence", () => {
    const incremental = new SparsePropExclusionBitsets();
    const live = new Map<string, SavedPropInstance>();
    const apply = (next: SavedPropInstance | null, id: string) => {
      const previous = live.get(id) ?? null;
      if (next) live.set(id, next); else live.delete(id);
      incremental.applyDelta(previous, next);
    };
    apply(envProp("a", address(3), "active"), "a");
    apply(envProp("a", address(3), "destroyed"), "a");
    apply(envProp("b", address(40, 2, 1), "destroyed"), "b");
    apply(envProp("b", address(40, 2, 1), "hidden"), "b");
    apply(envProp("c", address(3), "destroyed"), "c");
    apply(envProp("a", address(3), "active"), "a");
    apply(null, "b");
    apply(envProp("d", address(9, 0, 5), "destroyed"), "d");
    apply(envProp("d", address(10, 0, 5), "destroyed"), "d");

    const rebuilt = SparsePropExclusionBitsets.fromSavedProps([...live.values()]);
    expect(incremental.counters()).toEqual(rebuilt.counters());
    expect(incremental.contentEquals(rebuilt)).toBe(true);
    expect(rebuilt.contentEquals(incremental)).toBe(true);
  });

  it("contentEquals detects divergence", () => {
    const a = SparsePropExclusionBitsets.fromSavedProps([envProp("a", address(3))]);
    const b = SparsePropExclusionBitsets.fromSavedProps([envProp("a", address(4))]);
    expect(a.contentEquals(b)).toBe(false);
  });
});

describe("dirty tile/layer invalidation", () => {
  it("one edit dirties exactly one tile/layer — not zero, not all", () => {
    const exclusions = SparsePropExclusionBitsets.fromSavedProps([
      envProp("a", address(3, 0, 0)),
      envProp("b", address(7, 4, 4)),
    ]);
    exclusions.consumeDirtyTileLayers();
    exclusions.applyDelta(envProp("a", address(3, 0, 0), "destroyed"), envProp("a", address(3, 0, 0), "active"));
    const dirty = exclusions.consumeDirtyTileLayers();
    expect(dirty).toHaveLength(1);
    expect(dirty[0]).toEqual({ tileKey: { x: 0, z: 0 }, layer: "tree" });
  });

  it("consume clears the dirty set", () => {
    const exclusions = new SparsePropExclusionBitsets();
    exclusions.applyDelta(null, envProp("a", address(3)));
    expect(exclusions.consumeDirtyTileLayers()).toHaveLength(1);
    expect(exclusions.consumeDirtyTileLayers()).toHaveLength(0);
  });

  it("an address change across tiles dirties both tiles", () => {
    const exclusions = SparsePropExclusionBitsets.fromSavedProps([envProp("a", address(3, 0, 0))]);
    exclusions.consumeDirtyTileLayers();
    exclusions.applyDelta(envProp("a", address(3, 0, 0)), envProp("a", address(3, 9, 9)));
    const dirty = exclusions.consumeDirtyTileLayers();
    expect(dirty).toHaveLength(2);
  });

  it("a no-op delta dirties nothing", () => {
    const exclusions = SparsePropExclusionBitsets.fromSavedProps([envProp("a", address(3))]);
    exclusions.consumeDirtyTileLayers();
    exclusions.applyDelta(envProp("a", address(3), "destroyed"), envProp("a", address(3), "hidden"));
    exclusions.applyDelta(envProp("p", address(0), "active"), envProp("p", address(0), "active"));
    expect(exclusions.consumeDirtyTileLayers()).toHaveLength(0);
  });

  it("fresh fromSavedProps reports its populated tiles as dirty", () => {
    const exclusions = SparsePropExclusionBitsets.fromSavedProps([
      envProp("a", address(3, 0, 0)),
      envProp("b", address(7, 4, 4)),
    ]);
    expect(exclusions.consumeDirtyTileLayers()).toHaveLength(2);
  });
});
