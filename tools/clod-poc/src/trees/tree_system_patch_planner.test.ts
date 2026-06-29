import { describe, expect, it } from "vitest";
import type { ClodPageNode } from "../types.js";
import {
  countTreePatchInstances,
  selectRetainedTreePatches,
  selectTreePatchCandidates,
  shouldDeferTreePatchRefresh,
  treePatchIsInRange,
  type TreePatchDistanceInfo,
} from "./tree_system_patch_planner.js";

describe("tree system patch planning helpers", () => {
  it("checks patch range with patch radius included", () => {
    expect(treePatchIsInRange(0, 0, 10, 0, 8, 2)).toBe(true);
    expect(treePatchIsInRange(0, 0, 10.1, 0, 8, 2)).toBe(false);
  });

  it("selects retained patches by distance", () => {
    const patches = [
      patch("near", 0, 0, 2, 3),
      patch("edge", 10, 0, 2, 1),
      patch("far", 12.1, 0, 2, 5),
    ];

    expect(selectRetainedTreePatches(patches, 0, 0, 8).map((patch) => patch.nodeId))
      .toEqual(["near", "edge"]);
  });

  it("sorts new patch candidates by nearest footprint center", () => {
    const candidates = selectTreePatchCandidates(
      [node("far", 40, 0, 48, 8), node("near", 4, 0, 12, 8), node("existing", 20, 0, 28, 8)],
      new Set(["existing"]),
      0,
      0,
      50,
    );

    expect(candidates.map((candidate) => candidate.node.id)).toEqual(["near", "far"]);
    expect(candidates[0].distance).toBeLessThan(candidates[1].distance);
  });

  it("filters candidates outside distance plus footprint radius", () => {
    const candidates = selectTreePatchCandidates(
      [node("outside", 100, 0, 108, 8), node("inside", 8, 0, 16, 8)],
      new Set(),
      0,
      0,
      20,
    );

    expect(candidates.map((candidate) => candidate.node.id)).toEqual(["inside"]);
  });

  it("counts existing tree instances and detects deferred refresh", () => {
    expect(countTreePatchInstances([patch("a", 0, 0, 1, 3), patch("b", 0, 0, 1, 4)])).toBe(7);
    expect(shouldDeferTreePatchRefresh(1, 2)).toBe(true);
    expect(shouldDeferTreePatchRefresh(2, 2)).toBe(false);
  });
});

function patch(
  nodeId: string,
  centerX: number,
  centerZ: number,
  radius: number,
  instanceCount: number,
): TreePatchDistanceInfo {
  return {
    nodeId,
    centerX,
    centerZ,
    radius,
    instances: new Array(instanceCount).fill(null),
  };
}

function node(id: string, minX: number, minZ: number, maxX: number, maxZ: number): ClodPageNode {
  return {
    id,
    level: 0,
    children: [],
    mesh: null,
    footprint: { minX, minZ, maxX, maxZ },
    bounds: { center: [0, 0, 0], radius: 0, minY: 0, maxY: 0 },
    errorWorld: 0,
    lowBenefit: false,
  } as unknown as ClodPageNode;
}
