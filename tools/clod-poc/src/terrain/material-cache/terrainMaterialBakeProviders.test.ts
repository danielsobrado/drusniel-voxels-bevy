import { describe, expect, it } from "vitest";
import { DEFAULT_TERRAIN_MATERIAL_CACHE_CONFIG } from "./terrainMaterialCacheConfig.js";
import { bakeFarSummaryTerrainMaterial, buildSlopeCurvature } from "./terrainMaterialBakeProviders.js";
import type { FarSummaryTile } from "../../naadf/types.js";

describe("terrain material bake providers", () => {
  it("builds finite slope and curvature channels", () => {
    const heights = new Float32Array([
      0, 1,
      2, 3,
    ]);
    const channel = buildSlopeCurvature(heights, 2, 1);
    expect(channel).toHaveLength(8);
    for (const value of channel) expect(Number.isFinite(value)).toBe(true);
  });

  it("bakes far-summary color and canopy/water coverage", () => {
    const tile = makeTile();
    const payload = bakeFarSummaryTerrainMaterial({ tile }, DEFAULT_TERRAIN_MATERIAL_CACHE_CONFIG);
    expect(payload.farColor?.available).toBe(true);
    expect(payload.coverage?.available).toBe(true);
    expect(payload.farColor?.data).toHaveLength(16);
    expect(payload.coverage?.data[0]).toBeGreaterThan(0);
    expect(payload.coverage?.data[1]).toBeGreaterThan(0);
  });
});

function makeTile(): FarSummaryTile {
  return {
    key: { ring: 0, x: 1, z: 2 },
    originX: 0,
    originZ: 0,
    cellM: 1,
    resolution: 2,
    minHeight: new Float32Array([0, 1, 2, 3]),
    maxHeight: new Float32Array([0, 1, 2, 3]),
    avgHeight: new Float32Array([0, 1, 2, 3]),
    dominantMaterial: new Uint16Array([0, 1, 2, 3]),
    canopyCoverage: new Float32Array([0.5, 0, 0, 0]),
    waterCoverage: new Float32Array([0.25, 0, 0, 0]),
    revision: 7,
    state: "ready",
  };
}
