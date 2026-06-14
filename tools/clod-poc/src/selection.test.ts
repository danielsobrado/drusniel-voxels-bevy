import { describe, expect, it } from "vitest";
import { selectCut, type SelectionParams } from "./selection.js";
import type { ClodPageNode, PageFootprint, PageMesh } from "./types.js";

const mesh: PageMesh = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
  normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
  materials: new Float32Array([0, 0, 0]),
  indices: new Uint32Array([0, 1, 2]),
};

function node(id: string, level: number, footprint: PageFootprint, children: ClodPageNode[] = []): ClodPageNode {
  return {
    id,
    level,
    children,
    mesh,
    footprint,
    bounds: {
      center: [(footprint.minX + footprint.maxX) / 2, 0, (footprint.minZ + footprint.maxZ) / 2],
      radius: Math.hypot(footprint.maxX - footprint.minX, footprint.maxZ - footprint.minZ),
    },
    errorWorld: 0,
    lowBenefit: false,
  };
}

describe("selectCut 2:1 enforcement", () => {
  it("splits only edge-adjacent coarse nodes that violate the level delta", () => {
    const children = [
      node("L1:0,0", 1, { minX: 0, minZ: 0, maxX: 2, maxZ: 2 }),
      node("L1:1,0", 1, { minX: 2, minZ: 0, maxX: 4, maxZ: 2 }),
      node("L1:0,1", 1, { minX: 0, minZ: 2, maxX: 2, maxZ: 4 }),
      node("L1:1,1", 1, { minX: 2, minZ: 2, maxX: 4, maxZ: 4 }),
    ];
    const coarse = node("L2:0,0", 2, { minX: 0, minZ: 0, maxX: 4, maxZ: 4 }, children);
    const fineNeighbor = node("L0:4,0", 0, { minX: 4, minZ: 0, maxX: 5, maxZ: 1 });
    const params: SelectionParams = {
      thresholdPx: 1000,
      hysteresisMergeFactor: 1.5,
      enforce21: true,
      viewportH: 720,
      fovY: Math.PI / 3,
      camPos: [10, 10, 10],
    };

    const result = selectCut([coarse, fineNeighbor], params, { split: new Set() });

    expect(result.forcedSplits).toBe(1);
    expect(result.rendered.map((rendered) => rendered.id)).not.toContain("L2:0,0");
    expect(result.rendered.map((rendered) => rendered.id)).toContain("L0:4,0");
  });
});
