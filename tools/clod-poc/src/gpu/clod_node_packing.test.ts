import { describe, expect, it } from "vitest";
import {
  CLOD_NODE_RECORD_FLOATS,
  packClodNodeInto,
  packClodNodes,
} from "./clod_node_packing.js";
import type { ClodPageNode, PageMesh } from "../types.js";

const mesh: PageMesh = {
  positions: new Float32Array([0, 0, 0]),
  normals: new Float32Array([0, 1, 0]),
  materials: new Float32Array([0]),
  indices: new Uint32Array([0]),
};

function node(id: string, level: number): ClodPageNode {
  return {
    id,
    level,
    children: [],
    mesh,
    footprint: { minX: 0, minZ: 0, maxX: 1, maxZ: 1 },
    bounds: { center: [1, 2, 3], radius: 4 },
    errorWorld: 5,
    lowBenefit: false,
  };
}

describe("CLOD WebGPU node packing", () => {
  it("packs center radius error and level into stable records", () => {
    const packed = new Float32Array(CLOD_NODE_RECORD_FLOATS);
    packClodNodeInto(packed, 0, node("L2:1,3", 2));

    expect([...packed]).toEqual([1, 2, 3, 4, 5, 2, 0, 0]);
  });

  it("builds stable id to node index lookup", () => {
    const nodes = [node("L0:0,0", 0), node("L1:0,0", 1)];
    const packed = packClodNodes(nodes);

    expect(packed.data.length).toBe(CLOD_NODE_RECORD_FLOATS * 2);
    expect(packed.nodeIndexById.get("L0:0,0")).toBe(0);
    expect(packed.nodeIndexById.get("L1:0,0")).toBe(1);
  });
});
