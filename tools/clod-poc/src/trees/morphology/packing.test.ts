import { describe, expect, it } from "vitest";
import {
  MORPHOLOGY_FLOATS,
  VEGETATION_TREE_INSTANCE_BYTES,
  VEGETATION_TREE_INSTANCE_FLOATS,
  packTreeInstanceMorphology,
  packVegetationTreeInstance,
  unpackTreeInstanceMorphology,
} from "./packing.js";
import type { TreeInstanceMorphology } from "./types.js";

const morphology: TreeInstanceMorphology = {
  age01: 0.4,
  leanX: -0.08,
  leanZ: 0.16,
  crownBiasX: -0.15,
  crownBiasZ: 0.2,
  crownWidth: 1.1,
  crownFlattening: 0.9,
  branchDroop: 0.1,
  foliageDensity: 0.8,
  health01: 0.7,
  rootFlare: 1.2,
  stiffness: 0.95,
};

describe("tree morphology packing", () => {
  it("uses three vec4 values in the prescribed order", () => {
    const packed = packTreeInstanceMorphology(morphology);
    expect(packed).toHaveLength(MORPHOLOGY_FLOATS);
    expect(Array.from(packed)).toEqual([
      expect.closeTo(0.4), expect.closeTo(-0.08), expect.closeTo(0.16), expect.closeTo(0.7),
      expect.closeTo(-0.15), expect.closeTo(0.2), expect.closeTo(1.1), expect.closeTo(0.9),
      expect.closeTo(0.1), expect.closeTo(0.8), expect.closeTo(1.2), expect.closeTo(0.95),
    ]);
    const unpacked = unpackTreeInstanceMorphology(packed);
    for (const key of Object.keys(morphology) as (keyof TreeInstanceMorphology)[]) {
      expect(unpacked[key]).toBeCloseTo(morphology[key], 6);
    }
  });

  it("packs the canonical 96-byte record without a side buffer", () => {
    const packed = packVegetationTreeInstance({
      positionScale: [10, 20, 30, 1.25],
      rotationNormalY: [0.5, 0.9, 2, 0],
      identity: [1, 0x00020003, 0xfedcba98, 0x76543210],
      morphology,
    });
    expect(packed.byteLength).toBe(VEGETATION_TREE_INSTANCE_BYTES);
    expect(new Float32Array(packed)).toHaveLength(VEGETATION_TREE_INSTANCE_FLOATS);
    expect(Array.from(new Uint32Array(packed).slice(8, 12))).toEqual([1, 0x00020003, 0xfedcba98, 0x76543210]);
  });

  it("clamps malformed values before packing and after unpacking", () => {
    const malformed = { ...morphology, age01: 99, leanX: -99, leanZ: 0, stiffness: Number.NaN };
    const unpacked = unpackTreeInstanceMorphology(packTreeInstanceMorphology(malformed));
    expect(unpacked.age01).toBe(1);
    expect(unpacked.leanX).toBeCloseTo(-0.22, 6);
    expect(unpacked.stiffness).toBeCloseTo(0.65, 6);
  });
});
