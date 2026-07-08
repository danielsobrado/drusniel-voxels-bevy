import { describe, expect, it } from "vitest";
import type { PageFootprint, PageMesh } from "../types.js";
import { assertNoInternalBorders } from "./validate.js";

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

const L2_FOOTPRINT: PageFootprint = {
  minX: 512,
  maxX: 768,
  minZ: 768,
  maxZ: 1024,
};

const L3_FOOTPRINT: PageFootprint = {
  minX: 512,
  maxX: 1024,
  minZ: 512,
  maxZ: 1024,
};

describe("assertNoInternalBorders generated child seams", () => {
  it("allows the L2 dyadic child seam reported by visual startup", () => {
    expect(() => assertNoInternalBorders(
      openQuad(609.5, 895.5),
      L2_FOOTPRINT,
      "L2:2,3 final",
    )).not.toThrow();
  });

  it("allows generated L2 outer page-border chains a few cells inside the footprint", () => {
    expect(() => assertNoInternalBorders(
      openQuad(699.5, 1020.5),
      L2_FOOTPRINT,
      "L2:2,3 final",
    )).not.toThrow();
  });

  it("allows generated L3 outer page-border chains with a larger parent LOD band", () => {
    expect(() => assertNoInternalBorders(
      openQuad(820.5, 1012.5),
      L3_FOOTPRINT,
      "L3:1,1 final",
    )).not.toThrow();
  });

  it("still rejects arbitrary internal open boundaries", () => {
    expect(() => assertNoInternalBorders(
      openQuad(609.5, 910.5),
      L2_FOOTPRINT,
      "L2:2,3 final",
    )).toThrow(/InternalBorderNotWelded/);
  });

  it("still rejects L2 boundaries just beyond the generated parent perimeter band", () => {
    expect(() => assertNoInternalBorders(
      openQuad(699.5, 1014.5),
      L2_FOOTPRINT,
      "L2:2,3 final",
    )).toThrow(/InternalBorderNotWelded/);
  });

  it("still rejects L3 boundaries just beyond the generated parent perimeter band", () => {
    expect(() => assertNoInternalBorders(
      openQuad(820.5, 1006.5),
      L3_FOOTPRINT,
      "L3:1,1 final",
    )).toThrow(/InternalBorderNotWelded/);
  });

  it("does not allow generated child seams without a parent LOD label", () => {
    expect(() => assertNoInternalBorders(
      openQuad(609.5, 895.5),
      L2_FOOTPRINT,
    )).toThrow(/InternalBorderNotWelded/);
  });
});
