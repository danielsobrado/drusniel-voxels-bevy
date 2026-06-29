import { describe, expect, it } from "vitest";
import {
  TREE_LODS,
  TREE_RING_SHADOW_CASCADE_COUNT,
  TREE_RING_SHADOW_PLANE_COUNT,
  TREE_RING_SHADOW_PLANE_WORDS,
  TREE_SPECIES,
  packTreeRingShadowCascadePlanes,
  treeRingShadowCascadePlaneOffset,
  treeRingShadowCasterGroupCount,
  treeRingShadowCasterGroupIndex,
  treeRingShadowCasterGroupRegion,
  treeRingShadowSafeCascadeCount,
} from "./index.js";

describe("tree ring shadow layout", () => {
  it("indexes groups by cascade then tree group", () => {
    const groupsPerCascade = TREE_SPECIES.length * TREE_LODS.length;

    expect(treeRingShadowCasterGroupCount()).toBe(TREE_RING_SHADOW_CASCADE_COUNT * groupsPerCascade);
    expect(treeRingShadowCasterGroupIndex("oak", "near", 0)).toBe(0);
    expect(treeRingShadowCasterGroupIndex("oak", "impostor", 0)).toBe(3);
    expect(treeRingShadowCasterGroupIndex("pine", "near", 0)).toBe(4);
    expect(treeRingShadowCasterGroupIndex("oak", "near", 1)).toBe(groupsPerCascade);
  });

  it("returns contiguous storage regions", () => {
    const region = treeRingShadowCasterGroupRegion("pine", "far", 2, 10);
    const expectedStart = treeRingShadowCasterGroupIndex("pine", "far", 2) * 10;

    expect(region).toEqual({ start: expectedStart, end: expectedStart + 10, firstInstance: expectedStart });
  });

  it("packs cascade planes", () => {
    const first = new Float32Array(TREE_RING_SHADOW_PLANE_COUNT * TREE_RING_SHADOW_PLANE_WORDS).fill(1);
    const second = new Float32Array(TREE_RING_SHADOW_PLANE_COUNT * TREE_RING_SHADOW_PLANE_WORDS).fill(2);
    const packed = packTreeRingShadowCascadePlanes([first, second], 4);

    expect(treeRingShadowSafeCascadeCount(99)).toBe(TREE_RING_SHADOW_CASCADE_COUNT);
    expect(packed[0]).toBe(1);
    expect(packed[treeRingShadowCascadePlaneOffset(1)]).toBe(2);
    expect(packed[treeRingShadowCascadePlaneOffset(2)]).toBe(0);
  });
});
