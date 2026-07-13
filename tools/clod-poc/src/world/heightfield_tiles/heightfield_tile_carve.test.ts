import { describe, expect, it } from "vitest";
import { createGraphHydrologySampler } from "../../water/graph_hydrology.js";
import { buildHydrologyGraph } from "../hydrology_graph/hydrology_graph_builder.js";
import { HEIGHTFIELD_TILE_RES } from "./heightfield_tile.js";
import { buildCarvedHeightfieldTile } from "./heightfield_tile_carve.js";
import { buildStartupHeightfieldRaster } from "../../terrain/startup_heightfield_raster.js";
import { HeightfieldTileCache } from "./heightfield_tile_cache.js";
import { heightfieldTileSampler } from "./heightfield_tile_sampler.js";
import { proceduralHeightfieldSampler } from "../heightfield_sampler.js";
import type { HeightfieldTileConfig } from "./heightfield_tile_config.js";

const CACHE_CONFIG: HeightfieldTileConfig = {
  enabled: true, radiusM: 0, maxResidentTiles: 1, maxInflightBatches: 1, maxTilesPerBatch: 1,
  evictDistanceMultiplier: 1, retryCooldownFrames: 1, predictionSeconds: 0, persistenceEnabled: false,
};

describe("carved heightfield tiles", () => {
  it("carves graph water features deterministically with exact shared borders", () => {
    const terrain = { surfaceHeight: (_x: number, z: number) => 100 - z * 0.02 };
    const graph = buildHydrologyGraph({
      worldId: "tile-carve", seed: 3, sizeM: { x: 512, z: 512 }, sampleHeight: terrain.surfaceHeight,
      config: { spacingM: 16, channelThresholdCells: 4 },
    });
    const hydrology = createGraphHydrologySampler(graph, terrain);
    const carve = { depthM: 7.5, power: 1.35, lakeBedDepthM: 3.3 };
    const left = buildCarvedHeightfieldTile({ x: 0, z: 0 }, { sampleHeight: terrain.surfaceHeight }, hydrology, carve, 1);
    const again = buildCarvedHeightfieldTile({ x: 0, z: 0 }, { sampleHeight: terrain.surfaceHeight }, hydrology, carve, 1);
    const right = buildCarvedHeightfieldTile({ x: 1, z: 0 }, { sampleHeight: terrain.surfaceHeight }, hydrology, carve, 1);

    expect(left.heights).toEqual(again.heights);
    let carvedSamples = 0;
    for (let index = 0; index < left.heights.length; index++) {
      const x = index % HEIGHTFIELD_TILE_RES;
      const z = (index - x) / HEIGHTFIELD_TILE_RES;
      if (left.heights[index]! < terrain.surfaceHeight(x, z) - 0.01) carvedSamples++;
    }
    expect(carvedSamples).toBeGreaterThan(0);
    for (let z = 0; z < HEIGHTFIELD_TILE_RES; z++) {
      expect(left.heights[z * HEIGHTFIELD_TILE_RES + HEIGHTFIELD_TILE_RES - 1])
        .toBe(right.heights[z * HEIGHTFIELD_TILE_RES]);
    }
    expect(left.heights).toBeInstanceOf(Float32Array);

    const raster = buildStartupHeightfieldRaster(256, (x, z) =>
      Math.fround(hydrology.carveHeight(x, z, terrain.surfaceHeight(x, z), carve)))!;
    for (const [x, z] of [[0, 0], [64, 91], [128, 128], [255, 255], [256, 256]]) {
      const rasterHeight = raster.heights[(z - raster.minCell) * raster.res + (x - raster.minCell)]!;
      expect(rasterHeight).toBe(left.heights[z * HEIGHTFIELD_TILE_RES + x]);
    }
  });

  it("makes integer mesh and fractional collider/prop samples read the carved tile authority", async () => {
    const terrain = { surfaceHeight: (_x: number, z: number) => 80 - z * 0.03 };
    const graph = buildHydrologyGraph({
      worldId: "cpu-authority", seed: 4, sizeM: { x: 256, z: 256 }, sampleHeight: terrain.surfaceHeight,
      config: { spacingM: 16, channelThresholdCells: 3 },
    });
    const hydrology = createGraphHydrologySampler(graph, terrain);
    const carve = { depthM: 7.5, power: 1.35, lakeBedDepthM: 3.3 };
    const cache = new HeightfieldTileCache(CACHE_CONFIG, 1, async (keys, revision) => ({
      tiles: keys.map((key) => buildCarvedHeightfieldTile(key, { sampleHeight: terrain.surfaceHeight }, hydrology, carve, revision)),
      buildMs: 1,
    }));
    cache.update({ x: 128, z: 128, frameIndex: 1 });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const sampler = heightfieldTileSampler(cache, { ...proceduralHeightfieldSampler(), sampleHeight: terrain.surfaceHeight });
    for (const [x, z] of [[32, 32], [128, 128], [200, 220]]) {
      expect(sampler.sampleHeight(x, z)).toBe(Math.fround(hydrology.carveHeight(x, z, terrain.surfaceHeight(x, z), carve)));
    }
    const x = 128.25;
    const z = 128.75;
    const corner = (cx: number, cz: number) => Math.fround(hydrology.carveHeight(cx, cz, terrain.surfaceHeight(cx, cz), carve));
    const a = corner(128, 128) * 0.75 + corner(129, 128) * 0.25;
    const b = corner(128, 129) * 0.75 + corner(129, 129) * 0.25;
    expect(sampler.sampleHeight(x, z)).toBeCloseTo(a * 0.25 + b * 0.75, 6);
  });
});
