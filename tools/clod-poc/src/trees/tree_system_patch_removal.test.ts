import { describe, expect, it } from "vitest";
import type { TreeInstance } from "./index.js";
import {
  collectFallingTreeInstances,
  planTreePatchRemoval,
  treeInstanceToFallingInstance,
  type RemovableTreePatch,
} from "./tree_system_patch_removal.js";

describe("tree system patch removal helpers", () => {
  it("converts a tree instance to a falling tree snapshot", () => {
    const instance = tree("oak", [1, 2, 3], 1.5, 0.25, 0.9);
    const falling = treeInstanceToFallingInstance(instance);

    expect(falling).toEqual({
      position: [1, 2, 3],
      velocity: 0,
      originalY: 2,
      species: "oak",
      scale: 1.5,
      rotationY: 0.25,
      normalY: 0.9,
    });
    expect(falling.position).not.toBe(instance.position);
  });

  it("collects falling trees from removed patches", () => {
    const falling = collectFallingTreeInstances([
      patch("a", [tree("oak", [0, 1, 2])]),
      patch("b", [tree("pine", [3, 4, 5]), tree("dead", [6, 7, 8])]),
    ]);

    expect(falling.map((tree) => tree.species)).toEqual(["oak", "pine", "dead"]);
    expect(falling.map((tree) => tree.originalY)).toEqual([1, 4, 7]);
  });

  it("partitions retained and removed patches and returns falling snapshots", () => {
    const patches = [
      patch("keep-a", [tree("oak", [0, 1, 2])]),
      patch("remove-a", [tree("pine", [3, 4, 5])]),
      patch("keep-b", [tree("dead", [6, 7, 8])]),
      patch("remove-b", [tree("oak", [9, 10, 11])]),
    ];

    const plan = planTreePatchRemoval(patches, new Set(["remove-a", "remove-b"]));

    expect(plan.retained.map((patch) => patch.nodeId)).toEqual(["keep-a", "keep-b"]);
    expect(plan.removed.map((patch) => patch.nodeId)).toEqual(["remove-a", "remove-b"]);
    expect(plan.falling.map((tree) => tree.position)).toEqual([[3, 4, 5], [9, 10, 11]]);
  });
});

function patch(nodeId: string, instances: TreeInstance[]): RemovableTreePatch {
  return { nodeId, instances };
}

function tree(
  species: "oak" | "pine" | "dead",
  position: [number, number, number],
  scale = 1,
  rotationY = 0,
  normalY = 1,
): TreeInstance {
  return {
    position,
    normalY,
    species,
    scale,
    rotationY,
  } as TreeInstance;
}
