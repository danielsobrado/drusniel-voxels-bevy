import { describe, expect, it } from "vitest";
import type { ClodPageNode, PageMesh } from "../types.js";
import { computeParentErrorWorld } from "./page_error_metric.js";

function flatMesh(y: number): PageMesh {
  return {
    positions: new Float32Array([0, y, 0, 1, y, 0, 0, y, 1, 1, y, 1]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    materials: new Float32Array([0, 0, 0, 0]),
    indices: new Uint32Array([0, 2, 1, 1, 2, 3]),
  };
}

function child(errorWorld: number): ClodPageNode {
  return {
    id: "L0:0,0",
    level: 0,
    children: [],
    mesh: flatMesh(0),
    footprint: { minX: 0, minZ: 0, maxX: 1, maxZ: 1 },
    bounds: { center: [0.5, 0, 0.5], radius: 1 },
    errorWorld,
    lowBenefit: false,
  };
}

describe("computeParentErrorWorld", () => {
  it("returns near zero for matching flat source and parent", () => {
    expect(computeParentErrorWorld(flatMesh(0), flatMesh(0), [child(0)])).toBeCloseTo(0);
  });

  it("returns positive error for displaced parent/source", () => {
    expect(computeParentErrorWorld(flatMesh(2), flatMesh(0), [child(0)])).toBeGreaterThan(0);
  });

  it("returns finite non-negative accumulated child error", () => {
    const error = computeParentErrorWorld(flatMesh(0), flatMesh(0), [child(3)]);
    expect(Number.isFinite(error)).toBe(true);
    expect(error).toBeGreaterThanOrEqual(3);
  });
});
