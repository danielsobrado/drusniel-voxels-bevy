import { describe, expect, it } from "vitest";
import biomeRegionWgsl from "../gpu/shaders/biome_region_field.wgsl?raw";
import {
  BIOME_IDS,
  BIOME_REGION_CELL_M,
  BIOME_REGION_CONTRACT,
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
const CONTRACT_FIELD_ORDER = [
  "regionCellM",
  "oceanHeightMarginM",
  "oceanIslandMaskMax",
  "coastHeightBandM",
  "coastShoreDistanceM",
  "mountainHeightAboveSeaM",
  "swampHeightAboveSeaM",
  "swampNoiseMax",
  "plainsDistanceMin",
  "plainsNoiseMin",
  "forestNoiseMin",
] as const;

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

function wgslFunctionBody(name: string): string {
  const start = biomeRegionWgsl.indexOf(`fn ${name}`);
  expect(start, `${name} function missing`).toBeGreaterThanOrEqual(0);
  const next = biomeRegionWgsl.indexOf("\nfn ", start + 1);
  return biomeRegionWgsl.slice(start, next === -1 ? undefined : next);
}

function expectContractField(fieldName: keyof typeof BIOME_REGION_CONTRACT): void {
  expect(wgslFunctionBody("classifyBiomeRegion")).toContain(`contract.${fieldName}`);
}

function parseDefaultWgslContract(): Record<string, number> {
  const body = wgslFunctionBody("defaultBiomeRegionContract");
  const constructorMatch = body.match(/return\s+BiomeRegionContract\(([^)]*)\)/s);
  expect(constructorMatch, "defaultBiomeRegionContract must return BiomeRegionContract(...)").not.toBeNull();
  const values = constructorMatch![1]
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => Number(entry));
  expect(values).toHaveLength(CONTRACT_FIELD_ORDER.length);
  return Object.fromEntries(CONTRACT_FIELD_ORDER.map((field, index) => [field, values[index]]));
}

describe("BiomeRegionField canonical classification", () => {
  it("pins a golden table for every biome branch", () => {
    const rows: GoldenBiomeRow[] = [
      { name: "ocean by height", x: 0, z: 0, height: SEA_LEVEL - 2, island: LAND_ISLAND, expected: BIOME_IDS.ocean },
      { name: "ocean by island mask", x: 0, z: 0, height: 48, island: { ...LAND_ISLAND, mask: 0.02 }, expected: BIOME_IDS.ocean },
      { name: "coast by sea band", x: 0, z: 0, height: SEA_LEVEL + 2, island: LAND_ISLAND, expected: BIOME_IDS.coast },
      { name: "coast by shore distance", x: 0, z: 0, height: 48, island: { ...LAND_ISLAND, shoreDistanceM: 20 }, expected: BIOME_IDS.coast },
      { name: "mountain", x: 0, z: 0, height: SEA_LEVEL + 50, island: LAND_ISLAND, expected: BIOME_IDS.mountain },
      { name: "swamp", x: -2000, z: -2000, height: SEA_LEVEL + 8, island: LAND_ISLAND, expected: BIOME_IDS.swamp },
      { name: "plains", x: -2000, z: 700, height: 48, island: LAND_ISLAND, expected: BIOME_IDS.plains },
      { name: "forest", x: -2000, z: -1400, height: 48, island: { ...LAND_ISLAND, nearestCenterX: -2000, nearestCenterZ: -1400 }, expected: BIOME_IDS.forest },
      { name: "meadows", x: -2000, z: -2000, height: 48, island: { ...LAND_ISLAND, nearestCenterX: -2000, nearestCenterZ: -2000 }, expected: BIOME_IDS.meadows },
    ];

    for (const row of rows) {
      expect(classify(row), row.name).toBe(row.expected);
    }
  });

  it("uses the same named contract fields in TypeScript CPU and WGSL classifier paths", () => {
    expect(biomeRegionWgsl).toContain("struct BiomeRegionContract");
    expect(wgslFunctionBody("classifyBiomeRegion")).toContain("contract : BiomeRegionContract");
    for (const field of Object.keys(BIOME_REGION_CONTRACT) as (keyof typeof BIOME_REGION_CONTRACT)[]) {
      expectContractField(field);
    }
  });

  it("keeps WGSL default contract values byte-aligned with TypeScript", () => {
    expect(parseDefaultWgslContract()).toEqual(BIOME_REGION_CONTRACT);
  });

  it("does not allow duplicated threshold literals inside the WGSL classifier", () => {
    const classifier = wgslFunctionBody("classifyBiomeRegion");
    for (const literal of ["1.5", "0.08", "4.0", "42.0", "420.0", "48.0", "8.0", "0.42", "0.72", "0.58", "0.46"]) {
      expect(classifier, `literal ${literal} must only live in defaultBiomeRegionContract`).not.toContain(literal);
    }
  });

  it("proves contract overrides change classification through the shared TypeScript path", () => {
    const defaultBiome = classifyBiomeRegion({
      x: 0,
      z: 0,
      height: SEA_LEVEL + 70,
      seed: SEED,
      seaLevel: SEA_LEVEL,
      regionCellM: BIOME_REGION_CELL_M,
      islandRadiusM: ISLAND_RADIUS_M,
      island: LAND_ISLAND,
    }).biome;
    const overriddenBiome = classifyBiomeRegion({
      x: 0,
      z: 0,
      height: SEA_LEVEL + 70,
      seed: SEED,
      seaLevel: SEA_LEVEL,
      regionCellM: BIOME_REGION_CELL_M,
      islandRadiusM: ISLAND_RADIUS_M,
      island: LAND_ISLAND,
      contract: { mountainHeightAboveSeaM: 120 },
    }).biome;

    expect(defaultBiome).toBe(BIOME_IDS.mountain);
    expect(overriddenBiome).not.toBe(BIOME_IDS.mountain);
  });

  it("keeps the WGSL classifier island-aware instead of origin-radial", () => {
    expect(biomeRegionWgsl).toContain("fn sampleBiomeIslandMask");
    expect(biomeRegionWgsl).toContain("nearestCenterX");
    expect(biomeRegionWgsl).toContain("nearestCenterZ");
    expect(biomeRegionWgsl).toContain("if (islandMask > bestMask)");
    expect(biomeRegionWgsl).toContain("if (shore > bestShore)");
    expect(biomeRegionWgsl).not.toContain("length(vec2<f32>(worldX, worldZ)) / 560.0");
  });
});
