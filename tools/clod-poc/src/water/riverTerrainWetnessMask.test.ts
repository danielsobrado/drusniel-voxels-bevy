import { describe, expect, it } from "vitest";
import {
  DEFAULT_RIVER_TERRAIN_WETNESS_MASK_RESOLUTION,
  MAX_RIVER_TERRAIN_WETNESS_MASK_RESOLUTION,
  MIN_RIVER_TERRAIN_WETNESS_MASK_RESOLUTION,
  parseRiverTerrainWetnessMaskResolution,
} from "./riverTerrainWetnessMask.js";

describe("river terrain wetness mask resolution", () => {
  it("uses a default for missing or invalid values", () => {
    expect(parseRiverTerrainWetnessMaskResolution(null)).toBe(DEFAULT_RIVER_TERRAIN_WETNESS_MASK_RESOLUTION);
    expect(parseRiverTerrainWetnessMaskResolution(undefined)).toBe(DEFAULT_RIVER_TERRAIN_WETNESS_MASK_RESOLUTION);
    expect(parseRiverTerrainWetnessMaskResolution("not-a-number")).toBe(DEFAULT_RIVER_TERRAIN_WETNESS_MASK_RESOLUTION);
    expect(parseRiverTerrainWetnessMaskResolution(Number.NaN)).toBe(DEFAULT_RIVER_TERRAIN_WETNESS_MASK_RESOLUTION);
  });

  it("clamps values to the supported range", () => {
    expect(parseRiverTerrainWetnessMaskResolution("1")).toBe(MIN_RIVER_TERRAIN_WETNESS_MASK_RESOLUTION);
    expect(parseRiverTerrainWetnessMaskResolution(999999)).toBe(MAX_RIVER_TERRAIN_WETNESS_MASK_RESOLUTION);
  });

  it("floors valid fractional values", () => {
    expect(parseRiverTerrainWetnessMaskResolution("257.9")).toBe(257);
  });
});
