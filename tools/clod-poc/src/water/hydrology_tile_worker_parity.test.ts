import { afterEach, describe, expect, it } from "vitest";
import { baseSurfaceHeight, setTerrainFieldConfig } from "../terrain/terrain.js";
import { makeFakeBodyCarvedSampler } from "./fakeBodyCarve.js";
import { buildHydrologyTileData } from "./hydrologyTileSource.js";
import type { WaterConfig } from "./waterConfig.js";

// The worker (hydrology_tile_build_worker.ts) reconstructs the main-thread sampler as
// makeFakeBodyCarvedSampler({ fakeBodies } as WaterConfig, { surfaceHeight: baseSurfaceHeight })
// with the same terrain field config installed. This test locks that exactness contract:
// tiles carved through the minimal configure payload must match tiles carved through the
// full water config bit for bit — if makeFakeBodyCarvedSampler ever starts reading more
// of WaterConfig, the worker path silently diverges and this test bites.

const FAKE_BODIES: WaterConfig["fakeBodies"] = {
  carveTerrain: true,
  lakes: [{ center: [100, 120], radius: [42, 30], levelOffset: 1.2 }],
  rivers: [
    { points: [[40, 60], [90, 90], [140, 130]], width: 9, levelOffset: 0.8, downstreamDrop: 3 },
  ],
};

const BUILD_OPTIONS = { tileSizeM: 64, tileRes: 16, drySentinelDepthM: 2 };
const TILES = [
  { tileX: 0, tileZ: 0 },
  { tileX: 1, tileZ: 1 },
  { tileX: -3, tileZ: 7 },
];

describe("hydrology tile worker parity", () => {
  afterEach(() => {
    setTerrainFieldConfig(null);
  });

  it("worker-style sampler reconstruction builds tiles bit-identical to the main-thread path", () => {
    setTerrainFieldConfig({ seed: 1337 });

    // Main-thread path: full water config (world_build_startup.ts).
    const fullConfig = { fakeBodies: FAKE_BODIES, enabled: true, source: "hydrology" } as WaterConfig;
    const mainSampler = makeFakeBodyCarvedSampler(fullConfig, { surfaceHeight: baseSurfaceHeight });
    const mainTiles = TILES.map((coord) =>
      buildHydrologyTileData(coord.tileX, coord.tileZ, mainSampler, BUILD_OPTIONS));

    // Worker path: minimal configure payload cast (hydrology_tile_build_worker.ts).
    const workerConfig = { fakeBodies: FAKE_BODIES } as WaterConfig;
    const workerSampler = makeFakeBodyCarvedSampler(workerConfig, { surfaceHeight: baseSurfaceHeight });
    const workerTiles = TILES.map((coord) =>
      buildHydrologyTileData(coord.tileX, coord.tileZ, workerSampler, BUILD_OPTIONS));

    for (let i = 0; i < TILES.length; i++) {
      const main = mainTiles[i]!;
      const worker = workerTiles[i]!;
      expect(worker.res).toBe(main.res);
      expect(worker.cellSize).toBe(main.cellSize);
      expect(Array.from(worker.terrainY)).toEqual(Array.from(main.terrainY));
      expect(Array.from(worker.waterY)).toEqual(Array.from(main.waterY));
      expect(Array.from(worker.bodyMask)).toEqual(Array.from(main.bodyMask));
      expect(Array.from(worker.flowX)).toEqual(Array.from(main.flowX));
      expect(Array.from(worker.flowZ)).toEqual(Array.from(main.flowZ));
      expect(Array.from(worker.moisture)).toEqual(Array.from(main.moisture));
      expect(Array.from(worker.bodyKind)).toEqual(Array.from(main.bodyKind));
      expect(Array.from(worker.bodyId)).toEqual(Array.from(main.bodyId));
    }
    // Sanity: the terrain is not trivially flat (the parity assertion must bite).
    const distinct = new Set(mainTiles.flatMap((tile) => Array.from(tile.terrainY)));
    expect(distinct.size).toBeGreaterThan(1);
  });
});
