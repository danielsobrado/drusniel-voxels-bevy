import { describe, expect, it } from "vitest";
import {
  decodeTreeImpostorDepthOffset,
  TREE_IMPOSTOR_CAPTURE_DISTANCE_RADIUS_MULTIPLIER,
  TREE_IMPOSTOR_DEPTH_FAR_RADIUS_MULTIPLIER,
  TREE_IMPOSTOR_DEPTH_GRID_SEGMENTS,
  TREE_IMPOSTOR_DEPTH_MAX_OFFSET_RADIUS,
  TREE_IMPOSTOR_DEPTH_NEAR_M,
  treeImpostorDepthRange,
} from "./tree_impostor_depth_contract.js";

function encodeDistance(distanceM: number, radiusM: number): number {
  const range = treeImpostorDepthRange(radiusM);
  return (distanceM - range.nearM) / (range.farM - range.nearM);
}

describe("tree impostor depth contract", () => {
  it("matches the fixed baker camera range", () => {
    expect(TREE_IMPOSTOR_DEPTH_NEAR_M).toBe(0.01);
    expect(TREE_IMPOSTOR_DEPTH_FAR_RADIUS_MULTIPLIER).toBe(6);
    expect(TREE_IMPOSTOR_CAPTURE_DISTANCE_RADIUS_MULTIPLIER).toBe(3);
    expect(TREE_IMPOSTOR_DEPTH_MAX_OFFSET_RADIUS).toBe(0.95);
    expect(TREE_IMPOSTOR_DEPTH_GRID_SEGMENTS).toBe(3);
    expect(treeImpostorDepthRange(10)).toEqual({
      nearM: 0.01,
      farM: 60,
      captureDistanceM: 30,
      maxOffsetM: 9.5,
    });
  });

  it("reconstructs signed depth around the capture center", () => {
    const radius = 10;
    expect(decodeTreeImpostorDepthOffset(encodeDistance(25, radius), 1, radius)).toBeCloseTo(5, 5);
    expect(decodeTreeImpostorDepthOffset(encodeDistance(35, radius), 1, radius)).toBeCloseTo(-5, 5);
  });

  it("clamps extreme depth and fades invalid coverage", () => {
    expect(decodeTreeImpostorDepthOffset(0, 1, 10)).toBeCloseTo(9.5, 5);
    expect(decodeTreeImpostorDepthOffset(1, 1, 10)).toBeCloseTo(-9.5, 5);
    expect(decodeTreeImpostorDepthOffset(0.5, 0, 10)).toBe(0);
    expect(decodeTreeImpostorDepthOffset(Number.NaN, 1, 10)).toBe(0);
    expect(decodeTreeImpostorDepthOffset(0.5, Number.NaN, 10)).toBe(0);
  });

  it("normalizes invalid radii without producing non-finite output", () => {
    const range = treeImpostorDepthRange(Number.NaN);
    expect(range).toEqual({
      nearM: 0.01,
      farM: 6,
      captureDistanceM: 3,
      maxOffsetM: 0.95,
    });
    expect(Number.isFinite(decodeTreeImpostorDepthOffset(0.5, 1, Number.NaN))).toBe(true);
  });
});
