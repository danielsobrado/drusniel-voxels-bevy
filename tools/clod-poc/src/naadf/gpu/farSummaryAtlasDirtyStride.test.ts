import { afterEach, describe, expect, it } from "vitest";
import { FarSummaryGpuAtlas } from "./farSummaryAtlas.js";
import { createTestNaadfConfig } from "../__tests__/testConfig.js";

const atlases: FarSummaryGpuAtlas[] = [];

function createAtlas(options: ConstructorParameters<typeof FarSummaryGpuAtlas>[0]): FarSummaryGpuAtlas {
  const atlas = new FarSummaryGpuAtlas(options);
  atlases.push(atlas);
  return atlas;
}

afterEach(() => {
  for (const atlas of atlases.splice(0)) atlas.dispose();
});

function readyTile(height: number, revision: number): any {
  return {
    key: { ring: 0, x: 1, z: 1 },
    originX: 64,
    originZ: 64,
    cellM: 32,
    resolution: 2,
    minHeight: new Float32Array([height - 1, height - 1, height - 1, height - 1]),
    maxHeight: new Float32Array([height + 1, height + 1, height + 1, height + 1]),
    avgHeight: new Float32Array([height, height, height, height]),
    dominantMaterial: new Uint16Array([1, 1, 1, 1]),
    canopyCoverage: new Float32Array([0, 0, 0, 0]),
    waterCoverage: new Float32Array([0, 0, 0, 0]),
    revision,
    state: "ready",
  };
}

function testState(tile: any, frame: number): any {
  const config = createTestNaadfConfig();
  config.farClipmap.tileCells = 2;
  config.farClipmap.rings = [{ name: "near", startM: 0, endM: 4096, cellM: 32 }];
  return {
    config,
    farTiles: new Map([["0:1,1", tile]]),
    predictedX: 64,
    predictedZ: 64,
    revision: frame,
    frame,
  };
}

describe("far-summary atlas dirty upload strides", () => {
  it("uses one component per pixel for packed R16F height dirty ranges", () => {
    const atlas = createAtlas({ tileCells: 2, tilesX: 3, tilesZ: 3, format: "packed_low_bandwidth" });

    atlas.updateFromState(testState(readyTile(20, 1), 1));
    atlas.updateFromState(testState(readyTile(24, 2), 2));

    const heightRanges = atlas.view.texture.updateRanges as Array<{ start: number; count: number }>;
    const materialRanges = atlas.view.materialTexture.updateRanges as Array<{ start: number; count: number }>;

    expect(heightRanges).toEqual([
      { start: 14, count: 2 },
      { start: 20, count: 2 },
    ]);
    expect(materialRanges).toEqual([
      { start: 56, count: 8 },
      { start: 80, count: 8 },
    ]);
  });
});
