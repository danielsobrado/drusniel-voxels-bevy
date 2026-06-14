import { describe, expect, it } from "vitest";
import {
  applySerializedNode,
  indexNodes,
  rehydrateBuildResult,
  type SerializedBuildResult,
  type SerializedClodNode,
} from "./clod_worker_protocol.js";
import type { PageMesh } from "./types.js";

function mesh(material = 0): PageMesh {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    materials: new Float32Array([material, material, material]),
    indices: new Uint32Array([0, 1, 2]),
  };
}

function serializedNode(id: string, level: number, childIds: (string | null)[] = []): SerializedClodNode {
  return {
    id,
    level,
    childIds,
    mesh: mesh(),
    footprint: { minX: 0, minZ: 0, maxX: 1, maxZ: 1 },
    bounds: { center: [0.5, 0, 0.5], radius: 1 },
    errorWorld: level,
    lowBenefit: false,
  };
}

describe("CLOD worker protocol", () => {
  it("rehydrates child links and applies snapshots to existing nodes", () => {
    const result: SerializedBuildResult = {
      roots: ["L1:0,0"],
      nodesByLevel: [
        [0, [serializedNode("L0:0,0", 0)]],
        [1, [serializedNode("L1:0,0", 1, ["L0:0,0"])]],
      ],
      stats: [],
      worldPagesX: 1,
      worldPagesZ: 1,
    };

    const build = rehydrateBuildResult(result);
    const nodesById = indexNodes(build);
    const root = build.roots[0];
    const child = nodesById.get("L0:0,0")!;
    expect(root.children[0]).toBe(child);

    const update = serializedNode("L0:0,0", 0);
    update.mesh = mesh(3);
    applySerializedNode(child, update, nodesById);

    expect(root.children[0]).toBe(child);
    expect(child.mesh.materials[0]).toBe(3);
  });
});
