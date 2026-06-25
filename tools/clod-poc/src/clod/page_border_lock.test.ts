import { describe, expect, it } from "vitest";
import type { PageFootprint, PageMesh } from "../types.js";
import { assertNoInternalBorders } from "./validate.js";
import { collectOuterBorderVertexKeys, validatePageBorderChains } from "./page_border_lock.js";

function gridMesh(): { mesh: PageMesh; footprint: PageFootprint } {
  const footprint = { minX: 0, minZ: 0, maxX: 4, maxZ: 4 };
  const positions: number[] = [];
  const normals: number[] = [];
  const materials: number[] = [];
  for (let z = 0; z <= 4; z++) {
    for (let x = 0; x <= 4; x++) {
      positions.push(x, 0, z);
      normals.push(0, 1, 0);
      materials.push(0);
    }
  }
  const indices: number[] = [];
  for (let z = 0; z < 4; z++) {
    for (let x = 0; x < 4; x++) {
      const a = z * 5 + x;
      const b = a + 1;
      const c = a + 5;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  return {
    footprint,
    mesh: {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      paintSlots: new Float32Array(materials),
      materialWeights: new Float32Array(materials.length * 4),
      materialWeightStride: 4,
      indices: new Uint32Array(indices),
    },
  };
}

describe("page border locks", () => {
  it("collects non-empty outer border keys for a valid page", () => {
    const { mesh, footprint } = gridMesh();
    expect(collectOuterBorderVertexKeys(mesh, footprint, 0.001).size).toBeGreaterThan(0);
  });

  it("validates border chains on footprint edges", () => {
    const { mesh, footprint } = gridMesh();
    expect(validatePageBorderChains(mesh, footprint, 0.001, 1)).toBe(4);
  });

  it("rejects an internal open seam before it can be treated as an outer border", () => {
    const footprint = { minX: 0, minZ: 0, maxX: 8, maxZ: 8 };
    const mesh: PageMesh = {
      positions: new Float32Array([
        3, 0, 3,
        5, 0, 3,
        3, 0, 5,
        5, 0, 5,
      ]),
      normals: new Float32Array([
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
      ]),
      paintSlots: new Float32Array([1, 1, 1, 1]),
      materialWeights: new Float32Array(16),
      materialWeightStride: 4,
      indices: new Uint32Array([0, 2, 1, 1, 2, 3]),
    };

    expect(() => assertNoInternalBorders(mesh, footprint)).toThrow(/InternalBorderNotWelded/);
  });
});
