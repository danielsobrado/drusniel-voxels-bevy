import { afterEach, describe, expect, it } from "vitest";
import { baseSurfaceHeight, setTerrainFieldConfig } from "../terrain/terrain.js";
import { makeFakeBodyCarvedSampler } from "./fakeBodyCarve.js";
import { buildHydrologyTileData } from "./hydrologyTileSource.js";
import type { WaterConfig } from "./waterConfig.js";

// The worker (hydrology_tile_build_worker.ts) reconstructs the main-thread sampler as
// makeFakeBodyCarvedSampler({ fakeBodies } as WaterConfig, { surfaceHeight: baseSurfaceHeight })
// with the same terrain field config installed. These tests lock both authority contracts:
// legacy mode carries the configured fake-body carve, while unified startup explicitly
// disables that carve and reconstructs the procedural terrain sampler bit for bit.

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

  it("worker-style sampler reconstruction builds legacy carved tiles bit-identically", () => {
    setTerrainFieldConfig({ seed: 1337 });

    const fullConfig = { fakeBodies: FAKE_BODIES, enabled: true, source: "hydrology" } as WaterConfig;
    const mainSampler = makeFakeBodyCarvedSampler(fullConfig, { surfaceHeight: baseSurfaceHeight });
    const mainTiles = TILES.map((coord) =>
      buildHydrologyTileData(coord.tileX, coord.tileZ, mainSampler, BUILD_OPTIONS));

    const workerConfig = { fakeBodies: FAKE_BODIES } as WaterConfig;
    const workerSampler = makeFakeBodyCarvedSampler(workerConfig, { surfaceHeight: baseSurfaceHeight });
    const workerTiles = TILES.map((coord) =>
      buildHydrologyTileData(coord.tileX, coord.tileZ, workerSampler, BUILD_OPTIONS));

    expectTilesEqual(workerTiles, mainTiles);
    const distinct = new Set(mainTiles.flatMap((tile) => Array.from(tile.terrainY)));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("worker-style sampler reconstruction matches the unified no-carve authority", () => {
    setTerrainFieldConfig({ seed: 1337 });
    const noCarve = { ...FAKE_BODIES, carveTerrain: false };
    const mainTiles = TILES.map((coord) =>
      buildHydrologyTileData(coord.tileX, coord.tileZ, { surfaceHeight: baseSurfaceHeight }, BUILD_OPTIONS));
    const workerSampler = makeFakeBodyCarvedSampler(
      { fakeBodies: noCarve } as WaterConfig,
      { surfaceHeight: baseSurfaceHeight },
    );
    const workerTiles = TILES.map((coord) =>
      buildHydrologyTileData(coord.tileX, coord.tileZ, workerSampler, BUILD_OPTIONS));

    expectTilesEqual(workerTiles, mainTiles);
  });
});

function expectTilesEqual(
  actual: ReturnType<typeof buildHydrologyTileData>[],
  expected: ReturnType<typeof buildHydrologyTileData>[],
): void {
  for (let index = 0; index < expected.length; index++) {
    const got = actual[index]!;
    const want = expected[index]!;
    expect(got.res).toBe(want.res);
    expect(got.cellSize).toBe(want.cellSize);
    expect(Array.from(got.terrainY)).toEqual(Array.from(want.terrainY));
    expect(Array.from(got.waterY)).toEqual(Array.from(want.waterY));
    expect(Array.from(got.bodyMask)).toEqual(Array.from(want.bodyMask));
    expect(Array.from(got.flowX)).toEqual(Array.from(want.flowX));
    expect(Array.from(got.flowZ)).toEqual(Array.from(want.flowZ));
    expect(Array.from(got.moisture)).toEqual(Array.from(want.moisture));
    expect(Array.from(got.bodyKind)).toEqual(Array.from(want.bodyKind));
    expect(Array.from(got.bodyId)).toEqual(Array.from(want.bodyId));
  }
}
