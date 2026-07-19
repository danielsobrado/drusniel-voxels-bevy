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

  it("allows generated L1 outer page-border chains within the dense-route near-edge band", () => {
    // L1 page span 128 cells (4 chunks × 16 × 2^1); matches L1:11,3 coast-route failure coords.
    const l1Footprint: PageFootprint = { minX: 1408, maxX: 1536, minZ: 384, maxZ: 512 };
    expect(() => assertNoInternalBorders(
      openQuad(1470, 388.5),
      l1Footprint,
      "L1:11,3 gpu welded fallback",
    )).not.toThrow();
    expect(() => assertNoInternalBorders(
      openQuad(1470, 397.5),
      l1Footprint,
      "L1:11,3 gpu welded fallback",
    )).not.toThrow();
  });

  it("keeps the wider L1 near-edge allowance scoped to GPU parent builds", () => {
    const l1Footprint: PageFootprint = { minX: 384, maxX: 512, minZ: 256, maxZ: 384 };
    expect(() => assertNoInternalBorders(
      openQuad(441.5, 367.5),
      l1Footprint,
      "L1:3,2 final",
    )).toThrow(/InternalBorderNotWelded/);
    expect(() => assertNoInternalBorders(
      openQuad(441.5, 367.5),
      l1Footprint,
      "L1:3,2 gpu final",
    )).not.toThrow();
  });

  it("allows submerged-floor open borders on parent GPU welded pages", () => {
    const l1Footprint: PageFootprint = { minX: 1408, maxX: 1536, minZ: 384, maxZ: 512 };
    const deep = openQuad(1455.5, 410.5);
    deep.positions[1] = -63.5;
    deep.positions[4] = -63.5;
    deep.positions[7] = -63.5;
    deep.positions[10] = -63.5;
    expect(() => assertNoInternalBorders(
      deep,
      l1Footprint,
      "L1:11,3 gpu welded last-resort",
    )).not.toThrow();
    const sea = openQuad(1476.5, 401);
    sea.positions[1] = -0.5;
    sea.positions[4] = -0.5;
    sea.positions[7] = -0.5;
    sea.positions[10] = -0.5;
    expect(() => assertNoInternalBorders(
      sea,
      l1Footprint,
      "L1:11,3 gpu welded last-resort",
    )).not.toThrow();
    expect(() => assertNoInternalBorders(
      sea,
      l1Footprint,
      "L1:11,3 final",
    )).toThrow(/InternalBorderNotWelded/);
  });

  it("still rejects arbitrary internal open boundaries", () => {
    expect(() => assertNoInternalBorders(
      openQuad(609.5, 910.5),
      L2_FOOTPRINT,
      "L2:2,3 final",
    )).toThrow(/InternalBorderNotWelded/);
  });

  it("still rejects L2 boundaries just beyond the generated parent perimeter band", () => {
    // L2 band = max(20, 8) = 20; place the open edge 21 cells inside maxZ.
    expect(() => assertNoInternalBorders(
      openQuad(699.5, 1002.5),
      L2_FOOTPRINT,
      "L2:2,3 final",
    )).toThrow(/InternalBorderNotWelded/);
  });

  it("still rejects L3 boundaries just beyond the generated parent perimeter band", () => {
    // L3 band = max(20, 16) = 20; place the open edge 21 cells inside maxZ.
    expect(() => assertNoInternalBorders(
      openQuad(820.5, 1002.5),
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
