import { describe, expect, it } from "vitest";
import { computeTerrainSourceHash, type TerrainSourceInputs } from "../../cache/terrainSource.js";
import { DEFAULT_BORDER_COAST_OCEAN_CONFIG } from "../../terrain/border_coast_config.js";

function source(): TerrainSourceInputs {
  return {
    scene: "infinite-islands",
    worldSeed: "1",
    worldPages: 16,
    worldMode: "infinite_islands",
    borderCoastMode: "none",
    generatorVersion: "0.22.0",
    digRevision: 0,
    hydrologyTerrain: null,
    startupHeightfield: null,
    borderCoastOceanConfig: { ...DEFAULT_BORDER_COAST_OCEAN_CONFIG, enabled: false },
    waterConfig: {
      enabled: true,
      source: "hydrology",
      fakeBodies: { carveTerrain: false },
      hydrology: { enabled: true, unifiedStartup: true },
    },
    proceduralTextureEnabled: false,
    proceduralTextureHash: null,
    stagedImportHash: null,
    longViewScene: true,
  };
}

describe("heightfield tile cache identity", () => {
  it("does not change the v7 terrain hash when cache residency metadata changes", async () => {
    const base = source();
    const withoutTiles = await computeTerrainSourceHash(base);
    const withTiles = await computeTerrainSourceHash({
      ...base,
      heightfieldTiles: {
        enabled: true,
        radiusM: 768,
        maxResidentTiles: 64,
      },
    } as TerrainSourceInputs & { heightfieldTiles: object });

    expect(withTiles).toBe(withoutTiles);
  });

  it("keys authoritative continent geometry by graph artifact and carve profile", async () => {
    const base = { ...source(), worldMode: "continent", hydrologyGraphHash: "graph-a",
      hydrologyCarve: { depthM: 7.5, power: 1.35, lakeBedDepthM: 3.3 } };
    const first = await computeTerrainSourceHash(base);
    expect(await computeTerrainSourceHash({ ...base, hydrologyGraphHash: "graph-b" })).not.toBe(first);
    expect(await computeTerrainSourceHash({ ...base,
      hydrologyCarve: { ...base.hydrologyCarve, depthM: 8 } })).not.toBe(first);
  });
});
