import { describe, expect, it } from "vitest";
import {
  makeTileKey,
  tileKeyToString,
  tileKeyEquals,
  worldToTileCoord,
  tileOrigin,
  tileCenter,
} from "./tile-key.js";

describe("far summary tile key", () => {
  it("produces a stable key string", () => {
    const k = makeTileKey(1, 3, -5, 32);
    const s = tileKeyToString(k);
    expect(s).toBe("r1_x3_z-5_cs32");
  });

  it("compares keys for equality", () => {
    const a = makeTileKey(0, 1, 2, 32);
    const b = makeTileKey(0, 1, 2, 32);
    const c = makeTileKey(0, 1, 3, 32);
    expect(tileKeyEquals(a, b)).toBe(true);
    expect(tileKeyEquals(a, c)).toBe(false);
  });

  it("negative tile coordinates work", () => {
    const k = makeTileKey(2, -10, -5, 64);
    expect(k.x).toBe(-10);
    expect(k.z).toBe(-5);
    const s = tileKeyToString(k);
    expect(s).toContain("x-10");
    expect(s).toContain("z-5");
  });

  it("maps world coordinate to expected tile coordinate", () => {
    const cellSizeM = 32;
    const tileCells = 32;

    expect(worldToTileCoord(0, cellSizeM, tileCells)).toBe(0);
    expect(worldToTileCoord(1023, cellSizeM, tileCells)).toBe(0);
    expect(worldToTileCoord(1024, cellSizeM, tileCells)).toBe(1);
    expect(worldToTileCoord(-1, cellSizeM, tileCells)).toBe(-1);
    expect(worldToTileCoord(-1025, cellSizeM, tileCells)).toBe(-2);
  });

  it("computes tile origin and center", () => {
    const cellSizeM = 32;
    const tileCells = 32;

    expect(tileOrigin(0, cellSizeM, tileCells)).toBe(0);
    expect(tileOrigin(1, cellSizeM, tileCells)).toBe(1024);
    expect(tileOrigin(-1, cellSizeM, tileCells)).toBe(-1024);

    expect(tileCenter(0, cellSizeM, tileCells)).toBe(512);
    expect(tileCenter(1, cellSizeM, tileCells)).toBe(1536);
    expect(tileCenter(-1, cellSizeM, tileCells)).toBe(-512);
  });
});
