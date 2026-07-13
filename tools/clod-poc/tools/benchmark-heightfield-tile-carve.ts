import { performance } from "node:perf_hooks";
import { baseSurfaceHeight, resolveTerrainFieldConfig, setTerrainFieldConfig } from "../src/terrain/terrain_surface.js";
import { createGraphHydrologySampler } from "../src/water/graph_hydrology.js";
import { buildHeightfieldTile } from "../src/world/heightfield_tiles/heightfield_tile.js";
import { buildCarvedHeightfieldTile } from "../src/world/heightfield_tiles/heightfield_tile_carve.js";
import { buildHydrologyGraph } from "../src/world/hydrology_graph/hydrology_graph_builder.js";

setTerrainFieldConfig(resolveTerrainFieldConfig({ seed: 19 }));
const graph = buildHydrologyGraph({
  worldId: "tile-carve-bench", seed: 19, sizeM: { x: 4096, z: 4096 },
  sampleHeight: baseSurfaceHeight, config: { channelThresholdCells: 128 },
});
const hydrology = createGraphHydrologySampler(graph, { surfaceHeight: baseSurfaceHeight });
const field = { sampleHeight: baseSurfaceHeight, sourceRevision: 1 };
const carve = { depthM: 7.5, power: 1.35, lakeBedDepthM: 3.3 };
const baseMs: number[] = [];
const carvedMs: number[] = [];
for (let index = 0; index < 12; index++) {
  const key = { x: index % 4, z: Math.floor(index / 4) };
  let startedAt = performance.now();
  buildHeightfieldTile(key, field, 1);
  baseMs.push(performance.now() - startedAt);
  startedAt = performance.now();
  buildCarvedHeightfieldTile(key, field, hydrology, carve, 1);
  carvedMs.push(performance.now() - startedAt);
}
const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
};
const baseP95 = percentile(baseMs, 0.95);
const carvedP95 = percentile(carvedMs, 0.95);
const overheadP95 = carvedP95 - baseP95;
console.log(`base tile p95: ${baseP95.toFixed(2)} ms`);
console.log(`carved tile p95: ${carvedP95.toFixed(2)} ms`);
console.log(`carve overhead p95: ${overheadP95.toFixed(2)} ms`);
if (overheadP95 > 15) process.exitCode = 1;

