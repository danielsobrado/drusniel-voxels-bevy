import { describe, expect, it } from "vitest";
import {
  decodeTreeImpostorDepthOffset,
  encodeTreeImpostorRelativeDepth,
  markTreeImpostorCenterRelativeDepth,
  TREE_IMPOSTOR_DEPTH_ENCODING,
  TREE_IMPOSTOR_DEPTH_EXTENT_DIVISOR,
  TREE_IMPOSTOR_DEPTH_FAR_RADIUS_MULTIPLIER,
  TREE_IMPOSTOR_DEPTH_GRID_SEGMENTS,
  TREE_IMPOSTOR_DEPTH_NEAR_M,
  treeImpostorDepthRange,
} from "./tree_impostor_depth_contract.js";

describe("tree impostor depth contract", () => {
  it("matches the fixed baker depth range", () => {
    expect(TREE_IMPOSTOR_DEPTH_NEAR_M).toBe(0.01);
    expect(TREE_IMPOSTOR_DEPTH_FAR_RADIUS_MULTIPLIER).toBe(6);
    expect(TREE_IMPOSTOR_DEPTH_EXTENT_DIVISOR).toBe(4);
    expect(TREE_IMPOSTOR_DEPTH_GRID_SEGMENTS).toBe(3);
    expect(treeImpostorDepthRange(10)).toEqual({
      nearM: 0.01,
      farM: 60,
      extentM: (60 - 0.01) / 4,
    });
  });

  it("versions only explicitly stamped current atlases", () => {
    const current: { depthEncoding?: string } = {};
    const legacy: { depthEncoding?: string } = {};

    markTreeImpostorCenterRelativeDepth(current);

    expect(current.depthEncoding).toBe(TREE_IMPOSTOR_DEPTH_ENCODING);
    expect(legacy.depthEncoding).toBeUndefined();
  });

  it("round-trips center-relative depth", () => {
    const radius = 10;
    for (const offset of [-10, -5, 0, 5, 10]) {
      const encoded = encodeTreeImpostorRelativeDepth(offset, radius);
      expect(decodeTreeImpostorDepthOffset(encoded, 1, radius)).toBeCloseTo(offset, 5);
    }
  });

  it("clamps extreme depth and fades invalid coverage", () => {
    const extent = treeImpostorDepthRange(10).extentM;
    expect(decodeTreeImpostorDepthOffset(0, 1, 10)).toBeCloseTo(-extent, 5);
    expect(decodeTreeImpostorDepthOffset(1, 1, 10)).toBeCloseTo(extent, 5);
    expect(decodeTreeImpostorDepthOffset(0.5, 0, 10)).toBe(0);
    expect(decodeTreeImpostorDepthOffset(Number.NaN, 1, 10)).toBe(0);
    expect(decodeTreeImpostorDepthOffset(0.5, Number.NaN, 10)).toBe(0);
    expect(encodeTreeImpostorRelativeDepth(Number.NaN, 10)).toBe(0.5);
  });

  it("normalizes invalid radii without producing non-finite output", () => {
    const range = treeImpostorDepthRange(Number.NaN);
    expect(range).toEqual({
      nearM: 0.01,
      farM: 6,
      extentM: (6 - 0.01) / 4,
    });
    expect(Number.isFinite(decodeTreeImpostorDepthOffset(0.5, 1, Number.NaN))).toBe(true);
  });
});
