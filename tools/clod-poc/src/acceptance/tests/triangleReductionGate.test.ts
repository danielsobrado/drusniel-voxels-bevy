import { describe, expect, it } from "vitest";
import { computeTriangleReduction } from "../triangleReductionGate.js";
import type { ClodPageNode } from "../../types.js";

function makeNode(level: number, triCount: number): ClodPageNode {
  const vc = triCount * 3;
  const positions = new Float32Array(vc * 3);
  const normals = new Float32Array(vc * 3);
  const paintSlots = new Float32Array(vc);
  const materialWeights = new Float32Array(vc * 4);
  for (let i = 0; i < vc; i++) {
    paintSlots[i] = 0;
    materialWeights[i * 4] = 1.0;
  }
  const indices = new Uint32Array(triCount * 3);
  for (let i = 0; i < triCount * 3; i++) indices[i] = i;

  return {
    id: `L${level}:0,0`,
    level,
    children: [],
    mesh: { positions, normals, paintSlots, materialWeights, materialWeightStride: 4, indices },
    footprint: { minX: 0, minZ: 0, maxX: 64, maxZ: 64 },
    bounds: { center: [32, 0, 32], radius: 45, minY: -1, maxY: 1 },
    errorWorld: level * 0.1,
    lowBenefit: false,
  };
}

describe("computeTriangleReduction", () => {
  it("equivalent covered area ratio passes", () => {
    const nodesByLevel = new Map<number, ClodPageNode[]>();
    nodesByLevel.set(0, [makeNode(0, 10000), makeNode(0, 10000), makeNode(0, 10000), makeNode(0, 10000)]);
    nodesByLevel.set(1, [makeNode(1, 5000)]);
    nodesByLevel.set(2, [makeNode(2, 2000)]);
    nodesByLevel.set(3, [makeNode(3, 1000)]);

    const metrics = computeTriangleReduction(nodesByLevel);
    expect(metrics.lod0Triangles).toBe(40000);
    expect(metrics.lod3Ratio).toBe(1000 / 40000);
    expect(metrics.lod3Ratio).toBeLessThanOrEqual(0.15);
  });

  it("ratio over threshold fails", () => {
    const nodesByLevel = new Map<number, ClodPageNode[]>();
    nodesByLevel.set(0, [makeNode(0, 100)]);
    nodesByLevel.set(3, [makeNode(3, 50)]);

    const metrics = computeTriangleReduction(nodesByLevel);
    expect(metrics.lod3Ratio).toBe(50 / 100);
    expect(metrics.lod3Ratio).toBeGreaterThan(0.15);
  });

  it("missing LOD3 still gives sensible results", () => {
    const nodesByLevel = new Map<number, ClodPageNode[]>();
    nodesByLevel.set(0, [makeNode(0, 1000)]);
    nodesByLevel.set(1, [makeNode(1, 500)]);

    const metrics = computeTriangleReduction(nodesByLevel);
    expect(metrics.lod3Triangles).toBe(0);
    expect(metrics.lod3Ratio).toBe(0);
  });
});
