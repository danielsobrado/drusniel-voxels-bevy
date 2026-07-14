import { afterEach, describe, expect, it } from "vitest";
import { setTerrainFieldConfig, resolveTerrainFieldConfig, setTerrainSurfaceOverride } from "../terrain/terrain.js";
import { surfaceHeightCore, setTerrainFieldCoreConfig } from "../gpu/terrain_field_core.js";
import { BIOME_IDS, BIOME_REGION_CELL_M, BiomeRegionField } from "./biome_region_field.js";
import { CanonicalWorldSource, ProceduralWorldSource, StreamedVoxelWorldSource } from "./world_source.js";

afterEach(() => {
  setTerrainFieldConfig(null);
  setTerrainFieldCoreConfig(null);
  setTerrainSurfaceOverride(null);
});

describe("CanonicalWorldSource", () => {
  it("uses the installed surface authority for height, biome, material, and ocean queries", () => {
    const terrain = resolveTerrainFieldConfig({ seed: 5, seaLevel: 18, islandShape: { enabled: false } });
    setTerrainFieldConfig(terrain);
    const source = new CanonicalWorldSource(terrain);

    setTerrainSurfaceOverride(() => -100);

    expect(source.sampleHeight(64, 64)).toBe(-100);
    expect(source.sampleBiome(64, 64)).toBe(BIOME_IDS.ocean);
    expect(source.sampleMaterial(64, 64)).toBe(BIOME_IDS.ocean);
    expect(source.oceanMask(64, 64)).toBe(1);

    setTerrainSurfaceOverride(() => 100);
    expect(source.sampleBiome(64, 64)).toBe(BIOME_IDS.mountain);
    expect(source.sampleMaterial(64, 64)).toBe(BIOME_IDS.mountain);
  });
});

describe("ProceduralWorldSource", () => {
  it("delegates height to its own terrain field core config", () => {
    const terrain = resolveTerrainFieldConfig({ seed: 0 });
    setTerrainFieldConfig(terrain);
    setTerrainFieldCoreConfig(terrain);
    const source = new ProceduralWorldSource(terrain);
    for (const [x, z] of [[0, 0], [128.5, 256.25], [-733.5, 5000.25]]) {
      expect(source.sampleHeight(x, z)).toBe(surfaceHeightCore(x, z, terrain));
    }
  });

  it("does not drift when global terrain config changes", () => {
    const terrain = resolveTerrainFieldConfig({ seed: 11, seaLevel: 18 });
    const source = new ProceduralWorldSource(terrain);
    const before = source.sampleHeight(285.71, 911);
    setTerrainFieldCoreConfig({ seed: 99, seaLevel: 30 });
    expect(source.sampleHeight(285.71, 911)).toBe(before);
    expect(source.sampleHeight(285.71, 911)).toBe(surfaceHeightCore(285.71, 911, terrain));
  });

  it("does not drift when the constructor input is mutated later", () => {
    const terrain = resolveTerrainFieldConfig({ seed: 11, seaLevel: 18, islandShape: { enabled: true } });
    const source = new ProceduralWorldSource(terrain);
    const before = source.sampleHeight(128, 256);

    terrain.seed = 99;
    terrain.seaLevel = 30;
    terrain.islandShape.enabled = false;

    expect(source.metadata.seed).toBe(11);
    expect(source.metadata.seaLevel).toBe(18);
    expect(source.metadata.terrain.seed).toBe(11);
    expect(source.metadata.terrain.islandShape.enabled).toBe(true);
    expect(source.sampleHeight(128, 256)).toBe(before);
  });

  it("exposes sea level, seed, and ocean rim metadata", () => {
    const terrain = resolveTerrainFieldConfig({
      seed: 42,
      seaLevel: 19,
      islandShape: { enabled: true, oceanRim: true, worldRadiusM: 4096 },
    });
    const source = new ProceduralWorldSource(terrain);
    expect(source.metadata.seed).toBe(42);
    expect(source.metadata.seaLevel).toBe(19);
    expect(source.metadata.bounds).toEqual({ radiusM: 4096 });
    expect(source.metadata.oceanRim).toBe(true);
  });

  it("uses biome ids as procedural material ids across the far terrain sample range", () => {
    const source = new ProceduralWorldSource(resolveTerrainFieldConfig({ seed: 7, islandShape: { enabled: true } }));
    const seen = new Set<number>();

    for (let z = -8192; z <= 8192; z += 512) {
      for (let x = -8192; x <= 8192; x += 512) {
        const material = source.sampleMaterial(x, z);
        expect(material).toBe(source.sampleBiome(x, z));
        expect(material).toBeGreaterThanOrEqual(BIOME_IDS.meadows);
        expect(material).toBeLessThanOrEqual(BIOME_IDS.ocean);
        seen.add(material);
      }
    }

    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("BiomeRegionField", () => {
  it("is deterministic for fixed coordinates and seed", () => {
    const field = new BiomeRegionField({ seed: 3, seaLevel: 18, islandShape: { enabled: true } });
    const first = field.sample(125, 512, 42);
    const second = field.sample(125, 512, 42);
    expect(second).toEqual(first);
  });

  it("uses the fixed GPU-compatible region cell size", () => {
    const field = new BiomeRegionField({ seed: 3, seaLevel: 18, regionCellM: BIOME_REGION_CELL_M });

    expect(field.regionCellM).toBe(BIOME_REGION_CELL_M);
    expect(() => new BiomeRegionField({ seed: 3, seaLevel: 18, regionCellM: BIOME_REGION_CELL_M + 1 })).toThrow(/match the shared GPU contract/);
  });

  it("does not drift when the constructor island shape is mutated later", () => {
    const islandShape = { enabled: true, radiusM: 560 };
    const field = new BiomeRegionField({ seed: 3, seaLevel: 18, islandShape });
    const first = field.sample(125, 512, 42);

    islandShape.radiusM = 1200;
    islandShape.enabled = false;

    expect(field.sample(125, 512, 42)).toEqual(first);
    expect(field.islandShape.radiusM).toBe(560);
    expect(field.islandShape.enabled).toBe(true);
  });

  it("covers the expected biome id range on a sampled island grid", () => {
    const field = new BiomeRegionField({ seed: 5, seaLevel: 18, islandShape: { enabled: true } });
    const seen = new Set<number>();
    for (let z = -2000; z <= 2000; z += 250) {
      for (let x = -2000; x <= 2000; x += 250) {
        seen.add(field.sample(x, z, 56 + ((x + z) % 80)).biome);
      }
    }
    expect(seen.has(BIOME_IDS.meadows)).toBe(true);
    expect(seen.has(BIOME_IDS.forest)).toBe(true);
    expect(seen.has(BIOME_IDS.mountain)).toBe(true);
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });
});

describe("StreamedVoxelWorldSource", () => {
  it("is a future-source stub with internally consistent metadata", () => {
    const source = new StreamedVoxelWorldSource({
      seed: 9,
      seaLevel: 21,
      oceanRim: true,
      terrain: resolveTerrainFieldConfig({ seed: 1, seaLevel: 18, islandShape: { oceanRim: false, worldRadiusM: 4096 } }),
    });

    expect(source.metadata.seed).toBe(9);
    expect(source.metadata.seaLevel).toBe(21);
    expect(source.metadata.terrain.seed).toBe(9);
    expect(source.metadata.terrain.seaLevel).toBe(21);
    expect(source.metadata.terrain.islandShape.seed).toBe(9);
    expect(source.metadata.terrain.islandShape.seaLevel).toBe(21);
    expect(source.metadata.oceanRim).toBe(true);
    expect(source.metadata.terrain.islandShape.oceanRim).toBe(true);
    expect(source.metadata.bounds).toEqual({ radiusM: 4096 });
  });

  it("throws for every sampling method until backed by streamed voxel data", () => {
    const source = new StreamedVoxelWorldSource({ seed: 9, seaLevel: 21 });
    expect(() => source.sampleHeight(0, 0)).toThrow(/sampleHeight is not implemented/);
    expect(() => source.sampleBiome(0, 0)).toThrow(/sampleBiome is not implemented/);
    expect(() => source.sampleMaterial(0, 0)).toThrow(/sampleMaterial is not implemented/);
    expect(() => source.oceanMask(0, 0)).toThrow(/oceanMask is not implemented/);
  });
});
