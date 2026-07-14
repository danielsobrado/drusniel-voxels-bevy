import { describe, expect, it } from "vitest";
import { buildHydrologyGraph } from "../world/hydrology_graph/hydrology_graph_builder.js";
import { createCarvedGraphHydrologySampler, createGraphHydrologySampler } from "./graph_hydrology.js";
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

  it("reports lake shore distance that grows toward the lake interior", () => {
    const terrain = { surfaceHeight: (x: number, z: number) =>
      x >= 2 && x <= 6 && z >= 2 && z <= 6 ? 0 : 10 };
    const graph = buildHydrologyGraph({
      worldId: "lake-shore-distance", seed: 1, sizeM: { x: 8, z: 8 },
      sampleHeight: terrain.surfaceHeight,
      config: { spacingM: 1, lakeMinDepthM: 0.01, channelThresholdCells: 999 },
    });
    const sampler = createGraphHydrologySampler(graph, terrain);
    const edge = sampler.sample(2, 4);
    const center = sampler.sample(4, 4);
    expect(edge.lakeMask).toBe(1);
    expect(edge.shoreDistance).toBe(0);
    expect(center.shoreDistance).toBeGreaterThan(edge.shoreDistance);
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

  it("reports water depth against the same carved surface as canonical terrain tiles", () => {
    const terrain = { surfaceHeight: (_x: number, z: number) => 100 - z };
    const graph = buildHydrologyGraph({
      worldId: "carved-water", seed: 3, sizeM: { x: 32, z: 32 }, sampleHeight: terrain.surfaceHeight,
      config: { spacingM: 1, channelThresholdCells: 3 },
    });
    const base = createGraphHydrologySampler(graph, terrain);
    const carved = createCarvedGraphHydrologySampler(graph, terrain, { depthM: 2, power: 1, lakeBedDepthM: 1 });
    const river = graph.rivers.flatMap((record) => record.vertices)[1]!;
    const expectedTerrainY = base.carveHeight(river.x, river.z, terrain.surfaceHeight(river.x, river.z), { depthM: 2, power: 1, lakeBedDepthM: 1 });

    expect(carved.sample(river.x, river.z).terrainY).toBe(expectedTerrainY);
  });

  it("matches the two-pass carved sampler semantics across dry, lake, and river samples", () => {
    const terrain = { surfaceHeight: (x: number, z: number) => 18 + x * 0.04 + z * 0.02 };
    const graph = buildHydrologyGraph({
      worldId: "combined-carved-sample",
      seed: 9,
      sizeM: { x: 256, z: 256 },
      originM: { x: 0, z: 0 },
      sampleHeight: terrain.surfaceHeight,
    });
    const carve = { depthM: 2.5, power: 1.2, lakeBedDepthM: 1.5 };
    const base = createGraphHydrologySampler(graph, terrain);
    const oracle = createGraphHydrologySampler(graph, {
      surfaceHeight: (x, z) => base.carveHeight(x, z, terrain.surfaceHeight(x, z), carve),
    });
    const combined = createCarvedGraphHydrologySampler(graph, terrain, carve);

    for (let z = 0; z <= 256; z += 8) {
      for (let x = 0; x <= 256; x += 8) {
        expect(combined.sample(x, z)).toEqual(oracle.sample(x, z));
      }
    }
  });
});
