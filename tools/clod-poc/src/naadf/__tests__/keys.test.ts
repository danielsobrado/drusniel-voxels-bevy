import { describe, expect, it } from "vitest";
import {
  chunkKeyToString,
  floorDiv,
  floorMod,
  worldToChunkKey,
} from "../keys.js";

describe("naadf keys", () => {
  it("chunk keys support negative coordinates", () => {
    expect(worldToChunkKey(-1, -1, 16)).toEqual({ x: -1, z: -1 });
    expect(worldToChunkKey(-17, 5, 16)).toEqual({ x: -2, z: 0 });
  });

  it("string conversion is stable", () => {
    const key = { x: -3, z: 42 };
    expect(chunkKeyToString(key)).toBe("c:-3,42");
    expect(chunkKeyToString(key)).toBe(chunkKeyToString({ x: -3, z: 42 }));
  });

  it("world position maps to the same chunk key across frames", () => {
    const a = worldToChunkKey(100.2, -50.7, 16);
    const b = worldToChunkKey(100.9, -50.1, 16);
    expect(a).toEqual(b);
  });

  it("floor division works for negatives", () => {
    expect(floorDiv(-1, 16)).toBe(-1);
    expect(floorMod(-1, 16)).toBe(15);
    expect(floorDiv(15, 16)).toBe(0);
    expect(floorMod(15, 16)).toBe(15);
  });
});
