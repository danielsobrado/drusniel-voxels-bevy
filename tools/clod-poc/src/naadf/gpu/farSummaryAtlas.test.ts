import { describe, expect, it } from "vitest";
import { FarSummaryGpuAtlas } from "./farSummaryAtlas.js";
import { createTestNaadfConfig } from "../__tests__/testConfig.js";

describe("FarSummaryGpuAtlas", () => {
  it("packs ready far-summary heights into a float texture", () => {
    const atlas = new FarSummaryGpuAtlas({ tileCells: 2, tilesX: 3, tilesZ: 3 });
    const config = createTestNaadfConfig();
    config.farClipmap.tileCells = 2;
    config.farClipmap.rings = [{ name: "test", startM: 0, endM: 4096, cellM: 32 }];
    const farTiles = new Map<string, any>();
    farTiles.set("0:1,1", {
      key: { ring: 0, x: 1, z: 1 },
      originX: 64,
      originZ: 64,
      cellM: 32,
      resolution: 2,
      minHeight: new Float32Array([19, 19, 19, 19]),
      maxHeight: new Float32Array([21, 21, 21, 21]),
      avgHeight: new Float32Array([20, 22, 24, 26]),
      dominantMaterial: new Uint16Array([1, 1, 1, 1]),
      canopyCoverage: new Float32Array(4),
      waterCoverage: new Float32Array(4),
      revision: 1,
      state: "ready",
    });

    atlas.updateFromState({ config, farTiles, predictedX: 64, predictedZ: 64, revision: 42 } as any);

    expect(atlas.view.valid).toBe(1);
    expect(atlas.view.widthCells).toBe(6);
    const data = atlas.view.texture.image.data as Float32Array;
    const firstPackedPixel = ((2 * atlas.view.widthCells) + 2) * 4;
    expect(data[firstPackedPixel]).toBe(20);
    expect(data[firstPackedPixel + 1]).toBe(19);
    expect(data[firstPackedPixel + 2]).toBe(21);
    expect(data[firstPackedPixel + 3]).toBe(1);
  });
});
