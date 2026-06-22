import { describe, expect, it } from "vitest";
import type { PageFootprint, PageMesh } from "../types.js";
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
      materials: new Float32Array(materials),
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
    expect(validatePageBorderChains(mesh, footprint, 0.001)).toBe(4);
  });
});
