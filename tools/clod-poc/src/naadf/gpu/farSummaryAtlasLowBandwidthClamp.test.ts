import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { createTestNaadfConfig } from "../__tests__/testConfig.js";
import { NaadfMetricsCollector } from "../metrics.js";
import { createNaadfWorldState } from "../summaryStreamer.js";
import { createTerrainSource } from "../terrainSource.js";
import type { FarSummaryTile } from "../types.js";
import { FarSummaryGpuAtlas } from "./farSummaryAtlas.js";

const HALF_FLOAT_MAX = 65504;
const atlases: FarSummaryGpuAtlas[] = [];

afterEach(() => {
  for (const atlas of atlases.splice(0)) atlas.dispose();
});

function makeAtlas(): FarSummaryGpuAtlas {
  const atlas = new FarSummaryGpuAtlas({
    tileCells: 2,
    tilesX: 3,
    tilesZ: 3,
    format: "packed_low_bandwidth",
  });
  atlases.push(atlas);
  return atlas;
}

function makeTile(height: number): FarSummaryTile {
  return {
    key: { ring: 0, x: 1, z: 1 },
    originX: 64,
    originZ: 64,
    cellM: 32,
    resolution: 2,
    minHeight: new Float32Array([height, height, height, height]),
    maxHeight: new Float32Array([height, height, height, height]),
    avgHeight: new Float32Array([height, height, height, height]),
    dominantMaterial: new Uint16Array([1, 1, 1, 1]),
    canopyCoverage: new Float32Array([0, 0, 0, 0]),
    waterCoverage: new Float32Array([0, 0, 0, 0]),
    revision: 1,
    state: "ready",
  };
}

function makeState(tile: FarSummaryTile) {
  const config = createTestNaadfConfig();
  config.farClipmap.tileCells = 2;
  config.farClipmap.rings = [{ name: "near", startM: 0, endM: 4096, cellM: 32 }];

  const state = createNaadfWorldState(config, createTerrainSource("flat"), new NaadfMetricsCollector());
  state.farTiles.set("0:1,1", tile);
  state.predictedX = 64;
  state.predictedZ = 64;
  return state;
}

describe("FarSummaryGpuAtlas low-bandwidth height packing", () => {
  it("clamps positive out-of-range height before half-float packing", () => {
    const atlas = makeAtlas();
    atlas.updateFromState(makeState(makeTile(HALF_FLOAT_MAX * 2)));

    const data = atlas.view.texture.image.data as Uint16Array;
    const firstPackedPixel = 2 * atlas.view.widthCells + 2;
    expect(data[firstPackedPixel]).toBe(THREE.DataUtils.toHalfFloat(HALF_FLOAT_MAX));
  });

  it("clamps negative out-of-range height before half-float packing", () => {
    const atlas = makeAtlas();
    atlas.updateFromState(makeState(makeTile(-HALF_FLOAT_MAX * 2)));

    const data = atlas.view.texture.image.data as Uint16Array;
    const firstPackedPixel = 2 * atlas.view.widthCells + 2;
    expect(data[firstPackedPixel]).toBe(THREE.DataUtils.toHalfFloat(-HALF_FLOAT_MAX));
  });
});
