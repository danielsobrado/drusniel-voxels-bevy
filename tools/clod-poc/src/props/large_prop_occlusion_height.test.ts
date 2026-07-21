import { describe, expect, it } from "vitest";
import {
  cloneLargePropOcclusionHeightPayload,
  createLargePropOcclusionHeightSampler,
  largePropOcclusionPayloadRegion,
  type LargePropOcclusionHeightPayload,
} from "./large_prop_occlusion_height.js";

function payload(): LargePropOcclusionHeightPayload {
  return {
    revision: 4,
    cellSizeM: 2,
    cellX: new Int32Array([-1, 0]),
    cellZ: new Int32Array([3, 3]),
    topY: new Float32Array([12, 20]),
    minX: -2,
    minZ: 6,
    maxX: 2,
    maxZ: 8,
  };
}

describe("large prop occlusion height payload", () => {
  it("composes conservative prop tops with terrain without per-sample result objects", () => {
    const sample = createLargePropOcclusionHeightSampler(payload(), (x, z) => x + z);

    expect(sample(-1, 7)).toBe(12);
    expect(sample(1, 7)).toBe(20);
    expect(sample(5, 7)).toBe(12);
  });

  it("preserves prop height when terrain data is missing", () => {
    const sample = createLargePropOcclusionHeightSampler(payload(), () => Number.NaN);

    expect(sample(1, 7)).toBe(20);
    expect(Number.isNaN(sample(10, 10))).toBe(true);
  });

  it("clones transfer arrays without detaching the active payload", () => {
    const source = payload();
    const cloned = cloneLargePropOcclusionHeightPayload(source);
    cloned.cellX[0] = 99;
    cloned.topY[0] = 99;

    expect(source.cellX[0]).toBe(-1);
    expect(source.topY[0]).toBe(12);
    expect(largePropOcclusionPayloadRegion(source)).toEqual({
      minX: -2,
      minZ: 6,
      maxX: 2,
      maxZ: 8,
    });
  });

  it("falls back for invalid or empty payloads", () => {
    const fallback = (x: number, z: number) => x - z;
    const empty = { ...payload(), cellX: new Int32Array(), cellZ: new Int32Array(), topY: new Float32Array() };
    expect(createLargePropOcclusionHeightSampler(empty, fallback)(4, 2)).toBe(2);
    expect(largePropOcclusionPayloadRegion(empty)).toBeNull();
  });
});
