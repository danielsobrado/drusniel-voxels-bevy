import { afterEach, describe, expect, it } from "vitest";
import { setTerrainFieldConfig, resolveTerrainFieldConfig } from "../terrain/terrain.js";
import { surfaceHeightCore, setTerrainFieldCoreConfig } from "../gpu/terrain_field_core.js";
import { BIOME_IDS, BiomeRegionField } from "./biome_region_field.js";
import { ProceduralWorldSource, StreamedVoxelWorldSource } from "./world_source.js";

afterEach(() => {
  setTerrainFieldConfig(null);
  setTerrainFieldCoreConfig(null);
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
});

describe("BiomeRegionField", () => {
  it("is deterministic for fixed coordinates and seed", () => {
    const field = new BiomeRegionField({ seed: 3, seaLevel: 18, islandShape: { enabled: true } });
    const first = field.sample(125, 512, 42);
    const second = field.sample(125, 512, 42);
    expect(second).toEqual(first);
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
  it("is a real future-source stub with metadata", () => {
    const source = new StreamedVoxelWorldSource({ seed: 9, seaLevel: 21 });
    expect(source.metadata.seed).toBe(9);
    expect(source.metadata.seaLevel).toBe(21);
    expect(() => source.sampleHeight(0, 0)).toThrow(/not implemented/);
  });
});
