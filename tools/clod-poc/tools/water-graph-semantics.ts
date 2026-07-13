import { baseSurfaceHeight, resolveTerrainFieldConfig, setTerrainFieldConfig } from "../src/terrain/terrain_surface.js";
import { checkHydrologyInvariants } from "../src/water/hydrologyInvariants.js";
import { HydrologySystem } from "../src/water/hydrologySystem.js";
import { DEFAULT_HYDROLOGY_CONFIG, cloneHydrologyConfig } from "../src/water/hydrologyConfig.js";
import { createGraphHydrologySampler } from "../src/water/graph_hydrology.js";
import { buildHydrologyGraph } from "../src/world/hydrology_graph/hydrology_graph_builder.js";

setTerrainFieldConfig(resolveTerrainFieldConfig({ seed: 19 }));
const graph = buildHydrologyGraph({
  worldId: "graph-semantics:19",
  seed: 19,
  sizeM: { x: 4096, z: 4096 },
  sampleHeight: baseSurfaceHeight,
  config: { channelThresholdCells: 128 },
});
const byId = new Map(graph.rivers.map((river) => [river.id, river]));
let brokenTerminals = 0;
let widthRegressions = 0;
for (const river of graph.rivers) {
  for (let index = 1; index < river.vertices.length; index++) {
    if (river.vertices[index]!.widthM < river.vertices[index - 1]!.widthM) widthRegressions++;
  }
  let cursor = river;
  const visited = new Set<string>();
  while (cursor.terminalKind === "river" && cursor.downstreamRiverId && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    const next = byId.get(cursor.downstreamRiverId);
    if (!next) break;
    cursor = next;
  }
  if (cursor.terminalKind === "river") brokenTerminals++;
}
const invalidLakeOutlets = graph.lakes.filter((lake) => !lake.terminal && lake.outletCell < 0).length;
const terrain = { surfaceHeight: baseSurfaceHeight };
const sampler = createGraphHydrologySampler(graph, terrain);
const config = cloneHydrologyConfig(DEFAULT_HYDROLOGY_CONFIG);
config.infinite.source = "graph";
config.infinite.maxResidentTiles = 8;
const system = HydrologySystem.build(config, 512, terrain, {
  infiniteWorldSamples: true,
  worldSampler: (x, z) => sampler.sample(x, z),
});
const invariants = checkHydrologyInvariants(system.grid);
console.log(`rivers: ${graph.rivers.length}, lakes: ${graph.lakes.length}`);
console.log(`broken terminals: ${brokenTerminals}`);
console.log(`width regressions: ${widthRegressions}`);
console.log(`invalid lake outlets: ${invalidLakeOutlets}`);
console.log(`hydrology invariants: ${invariants.passed ? "PASS" : invariants.failures.join("; ")}`);
if (brokenTerminals || widthRegressions || invalidLakeOutlets || !invariants.passed) process.exitCode = 1;

