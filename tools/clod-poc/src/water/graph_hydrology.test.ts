import { describe, expect, it } from "vitest";
import { buildHydrologyGraph } from "../world/hydrology_graph/hydrology_graph_builder.js";
import { createGraphHydrologySampler } from "./graph_hydrology.js";
import { buildHydrologyTileData } from "./hydrologyTileSource.js";

describe("graph hydrology sampling", () => {
  it("samples lake identity and a dry sentinel from the canonical graph", () => {
    const graph = buildHydrologyGraph({
      worldId: "lake-sample", seed: 1, sizeM: { x: 4, z: 4 },
      sampleHeight: (x, z) => x === 2 && z === 2 ? 0 : 10,
      config: { spacingM: 1, lakeMinDepthM: 0.01, channelThresholdCells: 999 },
    });
    const sampler = createGraphHydrologySampler(graph, { surfaceHeight: (x, z) => x === 2 && z === 2 ? 0 : 10 });
    const wet = sampler.sample(2, 2);
    expect(wet.lakeMask).toBe(1);
    expect(wet.bodyId).not.toBe(0);
    expect(wet.waterY).toBeGreaterThan(wet.terrainY);
    const dry = sampler.sample(0, 0);
    expect(dry.bodyMask).toBe(0);
    expect(dry.waterY).toBe(dry.terrainY - 2);
  });

  it("produces deterministic graph-backed tiles with exact shared borders", () => {
    const terrain = { surfaceHeight: (_x: number, z: number) => 100 - z };
    const graph = buildHydrologyGraph({
      worldId: "river-tiles", seed: 2, sizeM: { x: 32, z: 32 }, sampleHeight: terrain.surfaceHeight,
      config: { spacingM: 1, channelThresholdCells: 3 },
    });
    const graphSampler = createGraphHydrologySampler(graph, terrain);
    const sample = (x: number, z: number) => graphSampler.sample(x, z);
    const options = { tileSizeM: 16, tileRes: 16, drySentinelDepthM: 2 };
    const left = buildHydrologyTileData(0, 0, terrain, options, sample);
    const right = buildHydrologyTileData(1, 0, terrain, options, sample);
    for (let z = 0; z <= 16; z++) {
      expect(left.waterY[z * 17 + 16]).toBe(right.waterY[z * 17]);
      expect(left.bodyId[z * 17 + 16]).toBe(right.bodyId[z * 17]);
    }
  });
});
