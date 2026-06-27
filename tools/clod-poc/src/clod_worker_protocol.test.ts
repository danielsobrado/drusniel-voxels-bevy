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
    paintSlots: new Float32Array([material, material, material]),
    materialWeights: new Float32Array(12),
    materialWeightStride: 4,
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
    bounds: { center: [0.5, 0, 0.5], radius: 1, minY: 0, maxY: 0 },
    errorWorld: level,
    lowBenefit: false,
  };
}

function buildResult(nodesByLevel: SerializedBuildResult["nodesByLevel"], roots = ["L1:0,0"]): SerializedBuildResult {
  return {
    roots,
    nodesByLevel,
    stats: [],
    worldPagesX: 1,
    worldPagesZ: 1,
  };
}

describe("CLOD worker protocol", () => {
  it("rehydrates child links and applies snapshots to existing nodes", () => {
    const result = buildResult([
      [0, [serializedNode("L0:0,0", 0)]],
      [1, [serializedNode("L1:0,0", 1, ["L0:0,0"])]],
    ]);

    const build = rehydrateBuildResult(result);
    const nodesById = indexNodes(build);
    const root = build.roots[0];
    const child = nodesById.get("L0:0,0")!;
    expect(root.children[0]).toBe(child);

    const update = serializedNode("L0:0,0", 0);
    update.mesh = mesh(3);
    applySerializedNode(child, update, nodesById);

    expect(root.children[0]).toBe(child);
    expect(child.mesh.paintSlots[0]).toBe(3);
  });

  it("rejects build results with missing child references", () => {
    const result = buildResult([
      [0, [serializedNode("L0:0,0", 0)]],
      [1, [serializedNode("L1:0,0", 1, ["L0:missing"])]],
    ]);

    expect(() => rehydrateBuildResult(result)).toThrow("references missing child L0:missing");
  });

  it("rejects build results with missing roots", () => {
    const result = buildResult([
      [0, [serializedNode("L0:0,0", 0)]],
      [1, [serializedNode("L1:0,0", 1, ["L0:0,0"])]],
    ], ["L1:missing"]);

    expect(() => rehydrateBuildResult(result)).toThrow("references missing root L1:missing");
  });

  it("rejects duplicate node ids", () => {
    const result = buildResult([
      [0, [serializedNode("L0:0,0", 0), serializedNode("L0:0,0", 0)]],
      [1, [serializedNode("L1:0,0", 1, ["L0:0,0"])]],
    ]);

    expect(() => rehydrateBuildResult(result)).toThrow("duplicate node L0:0,0");
  });

  it("does not mutate a node when update child references are invalid", () => {
    const result = buildResult([
      [0, [serializedNode("L0:0,0", 0)]],
      [1, [serializedNode("L1:0,0", 1, ["L0:0,0"])]],
    ]);
    const build = rehydrateBuildResult(result);
    const nodesById = indexNodes(build);
    const root = build.roots[0];
    const previousChildren = root.children;
    const previousMesh = root.mesh;

    expect(() => applySerializedNode(root, serializedNode("L1:0,0", 1, ["L0:missing"]), nodesById))
      .toThrow("references missing child L0:missing");
    expect(root.children).toBe(previousChildren);
    expect(root.mesh).toBe(previousMesh);
  });
});
