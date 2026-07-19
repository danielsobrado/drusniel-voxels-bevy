import { describe, expect, it } from "vitest";
import { DEFAULT_BORDER_COAST_OCEAN_CONFIG } from "../../terrain/border_coast_config.js";
import { cloneHydrologyConfig } from "../../water/hydrologyConfig.js";
import {
  computeTerrainSourceHash,
  type TerrainSourceInputs,
} from "../terrainSource.js";

function source(): TerrainSourceInputs {
  const hydrology = cloneHydrologyConfig();
  return {
    scene: "infinite-islands",
    worldSeed: "1",
    worldPages: 16,
    generatorVersion: "test",
    digRevision: 0,
    hydrologyTerrain: null,
    borderCoastOceanConfig: DEFAULT_BORDER_COAST_OCEAN_CONFIG,
    waterConfig: {
      enabled: true,
      source: "hydrology",
      fakeBodies: { carveTerrain: false },
      hydrology: {
        enabled: true,
        unifiedStartup: true,
        gravelBars: hydrology.gravelBars,
        gravelBed: hydrology.gravelBed,
      },
    },
    proceduralTextureEnabled: false,
    proceduralTextureHash: null,
    stagedImportHash: null,
    longViewScene: true,
  };
}

describe("gravel bed terrain-source identity", () => {
  it("changes when the build-time gravel bed authority is enabled", async () => {
    const disabled = source();
    const enabled = source();
    enabled.waterConfig.hydrology.gravelBed = {
      ...enabled.waterConfig.hydrology.gravelBed!,
      enabled: true,
    };

    expect(await computeTerrainSourceHash(enabled)).not.toBe(await computeTerrainSourceHash(disabled));
  });

  it("changes when the deterministic gravel field changes", async () => {
    const a = source();
    const b = source();
    b.waterConfig.hydrology.gravelBars = {
      ...b.waterConfig.hydrology.gravelBars!,
      seedSalt: b.waterConfig.hydrology.gravelBars!.seedSalt + 1,
    };

    expect(await computeTerrainSourceHash(a)).not.toBe(await computeTerrainSourceHash(b));
  });
});
