import { describe, expect, it } from "vitest";
import biomeRegionWgsl from "../gpu/shaders/biome_region_field.wgsl?raw";
import {
  BIOME_COAST_HEIGHT_BAND_M,
  BIOME_COAST_SHORE_DISTANCE_M,
  BIOME_FOREST_NOISE_MIN,
  BIOME_IDS,
  BIOME_MOUNTAIN_HEIGHT_ABOVE_SEA_M,
  BIOME_OCEAN_HEIGHT_MARGIN_M,
  BIOME_OCEAN_ISLAND_MASK_MAX,
  BIOME_PLAINS_DISTANCE_MIN,
  BIOME_PLAINS_NOISE_MIN,
  BIOME_REGION_CELL_M,
  BIOME_SWAMP_HEIGHT_ABOVE_SEA_M,
  BIOME_SWAMP_NOISE_MAX,
  classifyBiomeRegion,
  type BiomeId,
} from "./biome_region_field.js";
import type { IslandMaskSample } from "./island_shape.js";

const SEA_LEVEL = 18;
const SEED = 3;
const ISLAND_RADIUS_M = 560;
const LAND_ISLAND: IslandMaskSample = {
  mask: 1,
  shoreDistanceM: 120,
  nearestCenterX: 0,
  nearestCenterZ: 0,
  cliffWeight: 0,
};

interface GoldenBiomeRow {
  name: string;
  x: number;
  z: number;
  height: number;
  island: IslandMaskSample;
  expected: BiomeId;
}

function classify(row: GoldenBiomeRow): BiomeId {
  return classifyBiomeRegion({
    x: row.x,
    z: row.z,
    height: row.height,
    seed: SEED,
    seaLevel: SEA_LEVEL,
    regionCellM: BIOME_REGION_CELL_M,
    islandRadiusM: ISLAND_RADIUS_M,
    island: row.island,
  }).biome;
}

function expectWgslNumber(value: number): void {
  expect(biomeRegionWgsl).toContain(Number.isInteger(value) ? `${value}.0` : String(value));
}

describe("BiomeRegionField canonical classification", () => {
  it("pins a golden table for every biome branch", () => {
    const rows: GoldenBiomeRow[] = [
      { name: "ocean by height", x: 0, z: 0, height: SEA_LEVEL - 2, island: LAND_ISLAND, expected: BIOME_IDS.ocean },
      { name: "ocean by island mask", x: 0, z: 0, height: 48, island: { ...LAND_ISLAND, mask: 0.02 }, expected: BIOME_IDS.ocean },
      { name: "coast by sea band", x: 0, z: 0, height: SEA_LEVEL + 2, island: LAND_ISLAND, expected: BIOME_IDS.coast },
      { name: "coast by shore distance", x: 0, z: 0, height: 48, island: { ...LAND_ISLAND, shoreDistanceM: 20 }, expected: BIOME_IDS.coast },
      { name: "mountain", x: 0, z: 0, height: SEA_LEVEL + 70, island: LAND_ISLAND, expected: BIOME_IDS.mountain },
      { name: "swamp", x: -2000, z: -2000, height: SEA_LEVEL + 8, island: LAND_ISLAND, expected: BIOME_IDS.swamp },
      { name: "plains", x: -2000, z: 700, height: 48, island: LAND_ISLAND, expected: BIOME_IDS.plains },
      { name: "forest", x: -2000, z: -1400, height: 48, island: { ...LAND_ISLAND, nearestCenterX: -2000, nearestCenterZ: -1400 }, expected: BIOME_IDS.forest },
      { name: "meadows", x: -2000, z: -2000, height: 48, island: { ...LAND_ISLAND, nearestCenterX: -2000, nearestCenterZ: -2000 }, expected: BIOME_IDS.meadows },
    ];

    for (const row of rows) {
      expect(classify(row), row.name).toBe(row.expected);
    }
  });

  it("keeps CPU threshold constants mirrored in WGSL", () => {
    for (const value of [
      BIOME_REGION_CELL_M,
      BIOME_OCEAN_HEIGHT_MARGIN_M,
      BIOME_OCEAN_ISLAND_MASK_MAX,
      BIOME_COAST_HEIGHT_BAND_M,
      BIOME_COAST_SHORE_DISTANCE_M,
      BIOME_MOUNTAIN_HEIGHT_ABOVE_SEA_M,
      BIOME_SWAMP_HEIGHT_ABOVE_SEA_M,
      BIOME_SWAMP_NOISE_MAX,
      BIOME_PLAINS_DISTANCE_MIN,
      BIOME_PLAINS_NOISE_MIN,
      BIOME_FOREST_NOISE_MIN,
    ]) {
      expectWgslNumber(value);
    }
  });

  it("keeps the WGSL classifier island-aware instead of origin-radial", () => {
    expect(biomeRegionWgsl).toContain("fn sampleBiomeIslandMask");
    expect(biomeRegionWgsl).toContain("islandMask < 0.08");
    expect(biomeRegionWgsl).toContain("shoreDistanceM < 42.0");
    expect(biomeRegionWgsl).toContain("nearestCenterX");
    expect(biomeRegionWgsl).toContain("nearestCenterZ");
    expect(biomeRegionWgsl).toContain("if (islandMask > bestMask)");
    expect(biomeRegionWgsl).toContain("if (shore > bestShore)");
    expect(biomeRegionWgsl).not.toContain("length(vec2<f32>(worldX, worldZ)) / 560.0");
  });
});
