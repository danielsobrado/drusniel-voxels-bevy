import { describe, expect, it } from "vitest";
import { l0PageRangeForRegion, parseRegionKey, regionCoord, regionKeyForWorld, regionKeyOf } from "../region_key.js";

interface RegionCase {
  value: number;
  expected: number;
}

const cases: readonly RegionCase[] = [
  { value: -512.001, expected: -2 },
  { value: -512, expected: -1 },
  { value: -0.5, expected: -1 },
  { value: 0, expected: 0 },
  { value: 511.999, expected: 0 },
  { value: 512, expected: 1 },
];

describe("save region keys", () => {
  it("uses floor semantics for negative coordinates", () => {
    for (const testCase of cases) expect(regionCoord(testCase.value)).toBe(testCase.expected);
    expect(regionKeyForWorld(-0.5, -512.001)).toBe("r_-1_-2");
    expect(regionKeyForWorld(512, 511.999)).toBe("r_1_0");
  });

  it("aligns one save region to one L3 page footprint", () => {
    expect(regionKeyOf(2, -3)).toBe("r_2_-3");
    expect(l0PageRangeForRegion(2, -3)).toEqual({ minPx: 16, maxPx: 23, minPz: -24, maxPz: -17 });
  });

  it("rejects non-canonical region keys", () => {
    expect(parseRegionKey("r_1_-2")).toEqual({ rx: 1, rz: -2 });
    expect(() => parseRegionKey("r_01_-2")).toThrow(/canonical/i);
  });
});
