import { describe, expect, it } from "vitest";
import pcg2dWgsl from "./pcg2d.wgsl?raw";
import hashWgsl from "./shaders/hash.wgsl?raw";
import {
  VEGETATION_CATEGORY,
  treePcg2dU32,
  vegetationStableIdentity,
} from "./pcg2d.js";

describe("canonical vegetation PCG identity", () => {
  it("matches the normative stable identity vectors", () => {
    expect(vegetationStableIdentity({
      worldSeed: 1,
      category: VEGETATION_CATEGORY.TREE,
      schemaVersion: 1,
      globalCellX: 0,
      globalCellZ: 0,
      classId: 2,
    })).toEqual([3370872567, 1728742118]);
    expect(vegetationStableIdentity({
      worldSeed: 19,
      category: VEGETATION_CATEGORY.DRESSING,
      schemaVersion: 1,
      globalCellX: -1,
      globalCellZ: -1,
      classId: 17,
    })).toEqual([682912007, 910565973]);
    expect(vegetationStableIdentity({
      worldSeed: 4026531841,
      category: VEGETATION_CATEGORY.STONE,
      schemaVersion: 3,
      globalCellX: -40000,
      globalCellZ: 40000,
      classId: 9,
    })).toEqual([2440714017, 2919868272]);
  });

  it("returns the unmasked integer words", () => {
    const [lo, hi] = treePcg2dU32(-123, 456, 0x1101);
    expect(Number.isInteger(lo)).toBe(true);
    expect(Number.isInteger(hi)).toBe(true);
    expect(lo).toBeGreaterThan(0xffffff);
  });

  it("keeps the WGSL authority on the same integer tuple fold", () => {
    expect(pcg2dWgsl).toContain("fn treePcg2dU32");
    expect(pcg2dWgsl).toContain("fn treePcg2d01");
    expect(hashWgsl).toContain("const VEGETATION_DOMAIN_CHANNEL: u32 = 0x1001u");
    expect(hashWgsl).toContain("const VEGETATION_CLUSTER_ID_CHANNEL: u32 = 0x1002u");
    expect(hashWgsl).toContain("const VEGETATION_IDENTITY_CHANNEL: u32 = 0x1003u");
    expect(hashWgsl).toContain("fn vegetationValueHash");
    expect(hashWgsl).toContain("fn vegetationStableIdentity");
    expect(`${pcg2dWgsl}\n${hashWgsl}`).not.toMatch(/fract\s*\(\s*sin/);
  });
});
