import { describe, expect, it } from "vitest";
import type { TerrainRecipe } from "../../types/world";
import { decodeTerrainRecipe, encodeTerrainRecipe } from "./terrainRecipe";

const testRecipe: TerrainRecipe = {
  version: 1,
  seed: 42,
  config: {
    height: { min: 14, max: 118, sea_level: 0 },
    continent: { scale: 0.001, amplitude: 40, octaves: 2, persistence: 0.5, lacunarity: 2 },
    mountains: {
      scale: 0.008,
      amplitude: 120,
      octaves: 7,
      persistence: 0.48,
      lacunarity: 2.3,
      ridge_power: 1.8,
      massif_scale: 0.0035,
      massif_amplitude: 38,
      massif_threshold: 0.38,
      massif_power: 1.65,
    },
    hills: { scale: 0.025, amplitude: 25, octaves: 4, persistence: 0.5, lacunarity: 2 },
    detail: { scale: 0.1, amplitude: 3, octaves: 3, persistence: 0.5, lacunarity: 2 },
    caves: { enabled: false },
    rivers: { enabled: true, scale: 0.003, width: 4, depth: 6, octaves: 3, tributary_scale: 0.008, tributary_width: 2 },
    water_bodies: {
      enabled: true,
      lakes: { enabled: true, spacing: 96, density: 0.38, min_radius: 18, max_radius: 42, min_depth: 3, max_depth: 8, shore_power: 1.45 },
      ponds: { enabled: true, spacing: 48, density: 0.34, min_radius: 7, max_radius: 17, min_depth: 2, max_depth: 5, shore_power: 1.25 },
      aquifers: { enabled: false, max_y: 10, noise_scale: 0.045, threshold: 0.84 },
    },
    biome_modifiers: {},
  },
};

describe("terrain recipe helpers", () => {
  it("round trips encoded recipes", () => {
    const encoded = encodeTerrainRecipe(testRecipe);
    expect(decodeTerrainRecipe(encoded)).toEqual(testRecipe);
  });

  it("rejects invalid recipe strings", () => {
    expect(decodeTerrainRecipe("not-a-recipe")).toBeNull();
    expect(decodeTerrainRecipe("tr-v1:not-json")).toBeNull();
  });
});
