import { describe, expect, it } from "vitest";
import type { PageMesh } from "../types.js";
import { normalizeMaterialWeights } from "./material_weights.js";

function testMesh(weights: number[]): PageMesh {
  return {
    positions: new Float32Array([0, 0, 0]),
    normals: new Float32Array([0, 1, 0]),
    paintSlots: new Float32Array([0]),
    materialWeights: new Float32Array(weights),
    materialWeightStride: weights.length,
    indices: new Uint32Array([0, 0, 0]),
  };
}

describe("normalizeMaterialWeights", () => {
  it("clamps small interpolation drift and renormalizes", () => {
    const mesh = testMesh([0.5011, -0.0011, 0.25, 0.25]);

    normalizeMaterialWeights(mesh, "test");

    expect([...mesh.materialWeights]).toEqual(expect.arrayContaining([expect.any(Number)]));
    expect(mesh.materialWeights[1]).toBe(0);
    expect([...mesh.materialWeights].reduce((acc, value) => acc + value, 0)).toBeCloseTo(1, 6);
    for (const weight of mesh.materialWeights) {
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(weight).toBeLessThanOrEqual(1);
    }
  });

  it("rejects larger material weight errors", () => {
    const mesh = testMesh([1.02, -0.02, 0, 0]);

    expect(() => normalizeMaterialWeights(mesh, "test")).toThrow(/outside \[0,1\]/);
  });
});
