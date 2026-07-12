import { describe, expect, it } from "vitest";
import { parseConfig } from "../../config.js";
import { DEFAULT_BORDER_COAST_OCEAN_CONFIG } from "../../terrain/border_coast_config.js";
import { resolveTerrainFieldConfig } from "../../terrain/terrain.js";
import configText from "../../../config/clod_pages.yaml?raw";
import { buildAcceptanceWorldCacheKey, diffAcceptanceWorldCacheKeyFields } from "../acceptanceWorldCacheKey.js";
import { buildVoxelSnapshotHash, type TerrainSourceInputs } from "../terrainSource.js";

const cfg = parseConfig(configText);

function baseTerrainSource(): TerrainSourceInputs {
  return {
    scene: "infinite-islands",
    worldSeed: "1",
    terrainFieldConfig: resolveTerrainFieldConfig({
      seed: 1,
      seaLevel: 18,
      islandShape: {
        enabled: true,
        oceanRim: true,
        worldRadiusM: 8192,
        spacingM: 1500,
        radiusM: 560,
        blendM: 260,
      },
    }),
    worldPages: 16,
    generatorVersion: cfg.meshopt_package_version,
    digRevision: 0,
    hydrologyTerrain: null,
    borderCoastOceanConfig: DEFAULT_BORDER_COAST_OCEAN_CONFIG,
    waterConfig: {
      enabled: false,
      source: "fake_bodies",
      fakeBodies: { carveTerrain: false },
      hydrology: { enabled: false, unifiedStartup: false },
    },
    proceduralTextureEnabled: true,
    proceduralTextureHash: "procedural-a",
    stagedImportHash: null,
    voxelSnapshotHash: "voxel-a",
    longViewScene: true,
  };
}

describe("acceptance world cache key", () => {
  it("is stable for identical infinite-islands source inputs", async () => {
    const a = await buildAcceptanceWorldCacheKey({ cfg, terrainSource: baseTerrainSource() });
    const b = await buildAcceptanceWorldCacheKey({ cfg, terrainSource: { ...baseTerrainSource() } });
    expect(a.key).toBe(b.key);
    expect(diffAcceptanceWorldCacheKeyFields(a, b)).toEqual([]);
  });

  it("changes when seed changes", async () => {
    const a = await buildAcceptanceWorldCacheKey({ cfg, terrainSource: baseTerrainSource() });
    const b = await buildAcceptanceWorldCacheKey({
      cfg,
      terrainSource: {
        ...baseTerrainSource(),
        worldSeed: "2",
        terrainFieldConfig: resolveTerrainFieldConfig({
          seed: 2,
          seaLevel: 18,
          islandShape: {
            enabled: true,
            oceanRim: true,
            worldRadiusM: 8192,
            spacingM: 1500,
            radiusM: 560,
            blendM: 260,
          },
        }),
      },
    });
    expect(a.key).not.toBe(b.key);
    expect(diffAcceptanceWorldCacheKeyFields(a, b)).toContain("seed");
  });

  it("changes when world size changes", async () => {
    const a = await buildAcceptanceWorldCacheKey({ cfg, terrainSource: baseTerrainSource() });
    const b = await buildAcceptanceWorldCacheKey({ cfg, terrainSource: { ...baseTerrainSource(), worldPages: 8 } });
    expect(a.key).not.toBe(b.key);
    expect(diffAcceptanceWorldCacheKeyFields(a, b)).toContain("worldPages");
  });

  it("changes when voxel snapshot changes", async () => {
    const voxelA = await buildVoxelSnapshotHash({ revision: 1, deltas: [{ x: 1, y: 0, z: 1, density: -1, revision: 1 }] });
    const voxelB = await buildVoxelSnapshotHash({ revision: 1, deltas: [{ x: 9, y: 0, z: 9, density: -1, revision: 1 }] });
    const a = await buildAcceptanceWorldCacheKey({ cfg, terrainSource: { ...baseTerrainSource(), voxelSnapshotHash: voxelA } });
    const b = await buildAcceptanceWorldCacheKey({ cfg, terrainSource: { ...baseTerrainSource(), voxelSnapshotHash: voxelB } });
    expect(a.key).not.toBe(b.key);
    expect(diffAcceptanceWorldCacheKeyFields(a, b)).toContain("voxelSnapshotHash");
  });

  it("changes when hydrology or carving config changes", async () => {
    const a = await buildAcceptanceWorldCacheKey({ cfg, terrainSource: baseTerrainSource() });
    const b = await buildAcceptanceWorldCacheKey({
      cfg,
      terrainSource: {
        ...baseTerrainSource(),
        hydrologyTerrain: { res: 2, worldCells: 128, carvedBed: new Float32Array([1, 2, 3, 4]) },
        waterConfig: {
          enabled: true,
          source: "hydrology",
          fakeBodies: { carveTerrain: true },
          hydrology: { enabled: true, unifiedStartup: false },
        },
      },
    });
    expect(a.key).not.toBe(b.key);
    expect(diffAcceptanceWorldCacheKeyFields(a, b)).toEqual(expect.arrayContaining(["hydrologyTerrain", "waterConfig"]));
  });

  it("distinguishes legacy carved-grid mode from unified startup mode", async () => {
    const legacySource = baseTerrainSource();
    const legacy = await buildAcceptanceWorldCacheKey({
      cfg,
      terrainSource: {
        ...legacySource,
        hydrologyTerrain: { res: 2, worldCells: 128, carvedBed: new Float32Array([1, 2, 3, 4]) },
        waterConfig: {
          ...legacySource.waterConfig,
          enabled: true,
          source: "hydrology",
          hydrology: { enabled: true, unifiedStartup: false },
        },
      },
    });
    const unifiedSource = baseTerrainSource();
    const unified = await buildAcceptanceWorldCacheKey({
      cfg,
      terrainSource: {
        ...unifiedSource,
        hydrologyTerrain: null,
        waterConfig: {
          ...unifiedSource.waterConfig,
          enabled: true,
          source: "hydrology",
          hydrology: { enabled: true, unifiedStartup: true },
        },
      },
    });
    expect(legacy.key).not.toBe(unified.key);
    expect(diffAcceptanceWorldCacheKeyFields(legacy, unified)).toEqual(
      expect.arrayContaining(["hydrologyTerrain", "waterConfig"]),
    );
  });

  it("changes when hydrologyTerrain flips populated to null with identical water config", async () => {
    const waterConfig = {
      enabled: true,
      source: "hydrology" as const,
      fakeBodies: { carveTerrain: false },
      hydrology: { enabled: true, unifiedStartup: false },
    };
    const populated = await buildAcceptanceWorldCacheKey({
      cfg,
      terrainSource: {
        ...baseTerrainSource(),
        hydrologyTerrain: { res: 2, worldCells: 128, carvedBed: new Float32Array([1, 2, 3, 4]) },
        waterConfig,
      },
    });
    const nulled = await buildAcceptanceWorldCacheKey({
      cfg,
      terrainSource: { ...baseTerrainSource(), hydrologyTerrain: null, waterConfig },
    });
    expect(populated.key).not.toBe(nulled.key);
    expect(diffAcceptanceWorldCacheKeyFields(populated, nulled)).toContain("hydrologyTerrain");
  });

  it("changes when the startup hydrology authority changes", async () => {
    const a = await buildAcceptanceWorldCacheKey({ cfg, terrainSource: baseTerrainSource() });
    const source = baseTerrainSource();
    const b = await buildAcceptanceWorldCacheKey({
      cfg,
      terrainSource: {
        ...source,
        waterConfig: {
          ...source.waterConfig,
          hydrology: { enabled: true, unifiedStartup: true },
        },
      },
    });
    expect(a.key).not.toBe(b.key);
    expect(diffAcceptanceWorldCacheKeyFields(a, b)).toContain("waterConfig");
  });
});
