import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROCEDURAL_TEXTURE_CONFIG,
  type ProceduralTextureConfig,
} from "./materialRecipes.js";
import { createProceduralTerrainTextures } from "./terrainTextureArrays.js";

const TERRAIN_HEIGHT_MAX_M = 118;

function tinyConfig(): ProceduralTextureConfig {
  const defaults = DEFAULT_PROCEDURAL_TEXTURE_CONFIG;
  return {
    ...defaults,
    noise: {
      ...defaults.noise,
      resolution: 8,
      periods: { value: 8, fbm: 6, ridged: 5, worley: 7 },
    },
    terrain: {
      ...defaults.terrain,
      layer_resolution: 2,
      material_order: ["grass", "rock", "snow", "mountain-scree"],
      materials: { ...defaults.terrain.materials },
    },
  };
}

describe("procedural terrain height bands", () => {
  it("moves from green terrain into rock before the current mountain ceiling", () => {
    const terrain = createProceduralTerrainTextures(tinyConfig());
    const byId = new Map(terrain.slots.map((slot) => [slot.selectedId, slot] as const));
    const grass = byId.get("generated:grass")!;
    const rock = byId.get("generated:rock")!;
    const snow = byId.get("generated:snow")!;
    const scree = byId.get("authored:mountain-scree")!;

    expect(grass.heightMax).toBeLessThan(70);
    expect(rock.heightMin).toBeLessThan(grass.heightMax);
    expect(scree.heightMin).toBeLessThan(snow.heightMin);
    expect(snow.heightMin).toBeLessThan(TERRAIN_HEIGHT_MAX_M);
    expect(rock.heightMax).toBeGreaterThan(100);

    terrain.albedoArray.dispose();
    terrain.normalArray.dispose();
  });
});
