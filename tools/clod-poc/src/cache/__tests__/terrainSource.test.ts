import { describe, expect, it } from "vitest";
import { DEFAULT_BORDER_COAST_OCEAN_CONFIG } from "../../terrain/border_coast_config.js";
import { computeTerrainSourceHash, hashBorderCoastConfig, type TerrainSourceInputs } from "../terrainSource.js";

const baseTerrainSource = (): TerrainSourceInputs => ({
  scene: "default",
  worldSeed: "0",
  worldPages: 8,
  generatorVersion: "0.22.0",
  digRevision: 0,
  hydrologyTerrain: null,
  borderCoastOceanConfig: DEFAULT_BORDER_COAST_OCEAN_CONFIG,
  waterConfig: {
    enabled: false,
    source: "fake_bodies",
    fakeBodies: { carveTerrain: false },
    hydrology: { enabled: false },
  },
  proceduralTextureEnabled: false,
  proceduralTextureHash: null,
  stagedImportHash: null,
  longViewScene: false,
});

describe("terrain source hash", () => {
  it("changes when scene changes", async () => {
    const a = await computeTerrainSourceHash(baseTerrainSource());
    const b = await computeTerrainSourceHash({ ...baseTerrainSource(), scene: "long-view" });
    expect(a).not.toBe(b);
  });

  it("changes when dig revision changes", async () => {
    const a = await computeTerrainSourceHash(baseTerrainSource());
    const b = await computeTerrainSourceHash({ ...baseTerrainSource(), digRevision: 3 });
    expect(a).not.toBe(b);
  });

  it("changes when border coast config changes", async () => {
    const input = baseTerrainSource();
    const a = await computeTerrainSourceHash(input);
    const b = await computeTerrainSourceHash({
      ...input,
      borderCoastOceanConfig: {
        ...input.borderCoastOceanConfig,
        coast: { ...input.borderCoastOceanConfig.coast, oceanStartCells: 999 },
      },
    });
    expect(a).not.toBe(b);
  });
});

describe("border coast hash", () => {
  it("is stable for identical config", async () => {
    const cfg = baseTerrainSource().borderCoastOceanConfig;
    const a = await hashBorderCoastConfig(cfg);
    const b = await hashBorderCoastConfig(cfg);
    expect(a).toBe(b);
  });
});
