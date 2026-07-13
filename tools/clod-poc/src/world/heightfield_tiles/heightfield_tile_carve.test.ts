import { describe, expect, it } from "vitest";
import { createGraphHydrologySampler } from "../../water/graph_hydrology.js";
import { buildHydrologyGraph } from "../hydrology_graph/hydrology_graph_builder.js";
import { HEIGHTFIELD_TILE_RES } from "./heightfield_tile.js";
import { buildCarvedHeightfieldTile } from "./heightfield_tile_carve.js";
import { buildStartupHeightfieldRaster } from "../../terrain/startup_heightfield_raster.js";

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
});
