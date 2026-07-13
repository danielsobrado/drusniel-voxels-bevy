import { describe, expect, it } from "vitest";
import type { PageFootprint, PageMesh } from "../types.js";
import type { SimplifyOutput } from "./simplify.js";
import { selectParentSimplificationCandidate } from "./quadtree.js";

function openQuad(x: number, z: number): PageMesh {
  return {
    positions: new Float32Array([
      x, 18, z,
      x + 1, 18, z,
      x, 18, z + 1,
      x + 1, 18, z + 1,
    ]),
    normals: new Float32Array([
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
    ]),
    paintSlots: new Float32Array([0, 0, 0, 0]),
    materialWeights: new Float32Array([
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
    ]),
    materialWeightStride: 4,
    indices: new Uint32Array([0, 1, 2, 2, 1, 3]),
  };
}

const L3_FOOTPRINT: PageFootprint = {
  minX: 0,
  maxX: 512,
  minZ: 0,
  maxZ: 512,
};

describe("parent simplification fallback", () => {
  it("keeps a welded L3 child seam when simplification opens an arbitrary internal boundary", () => {
    const welded = openQuad(239.48, 255.49);
    const simplified: SimplifyOutput = {
      mesh: openQuad(362.5, 233.5),
      resultError: 0.25,
      errorWorld: 2,
      lowBenefit: false,
    };

    const selected = selectParentSimplificationCandidate(
      simplified,
      welded,
      L3_FOOTPRINT,
      1e-8,
      "L3:0,0",
    );

    expect(selected.mesh).toBe(welded);
    expect(selected.lowBenefit).toBe(true);
    expect(selected.errorWorld).toBe(0);
  });
});
