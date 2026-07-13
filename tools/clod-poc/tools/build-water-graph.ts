import { performance } from "node:perf_hooks";
import { baseSurfaceHeight, resolveTerrainFieldConfig, setTerrainFieldConfig } from "../src/terrain/terrain_surface.js";
import { buildHydrologyGraph } from "../src/world/hydrology_graph/hydrology_graph_builder.js";

const sizeM = Number(process.argv[2] ?? 4096);
const seed = Number(process.argv[3] ?? 1);
if (!Number.isFinite(sizeM) || sizeM <= 0) throw new Error(`sizeM must be positive: ${process.argv[2]}`);
if (!Number.isFinite(seed)) throw new Error(`seed must be finite: ${process.argv[3]}`);

setTerrainFieldConfig(resolveTerrainFieldConfig({ seed }));
const startedAt = performance.now();
const graph = buildHydrologyGraph({
  worldId: `harness:${seed}:${sizeM}`,
  seed,
  sizeM: { x: sizeM, z: sizeM },
  sampleHeight: baseSurfaceHeight,
});
const buildMs = performance.now() - startedAt;
let longestRiverM = 0;
const riverLengths = new Map<string, number>();
const riversById = new Map(graph.rivers.map((river) => [river.id, river]));
function connectedLength(riverId: string, visiting = new Set<string>()): number {
  const cached = riverLengths.get(riverId);
  if (cached !== undefined) return cached;
  if (visiting.has(riverId)) return 0;
  visiting.add(riverId);
  const river = riversById.get(riverId)!;
  let lengthM = 0;
  for (let index = 1; index < river.vertices.length; index++) {
    const a = river.vertices[index - 1]!;
    const b = river.vertices[index]!;
    lengthM += Math.hypot(b.x - a.x, b.z - a.z);
  }
  if (river.downstreamRiverId) lengthM += connectedLength(river.downstreamRiverId, visiting);
  riverLengths.set(riverId, lengthM);
  return lengthM;
}
for (const river of graph.rivers) longestRiverM = Math.max(longestRiverM, connectedLength(river.id));
const terminalCounts = Object.fromEntries(
  ["river", "lake", "ocean", "terminal"].map((kind) => [kind, graph.rivers.filter((river) => river.terminalKind === kind).length]),
);
console.log(`macro grid: ${graph.macro.resX}x${graph.macro.resZ} (${graph.macro.resX * graph.macro.resZ} cells)`);
console.log(`build ms: ${buildMs.toFixed(2)}`);
console.log(`rivers: ${graph.rivers.length}`);
console.log(`lakes: ${graph.lakes.length}`);
console.log(`longest river: ${longestRiverM.toFixed(1)} m`);
console.log(`river terminals: ${JSON.stringify(terminalCounts)}`);
console.log(`largest lake: ${Math.max(0, ...graph.lakes.map((lake) => lake.areaCells))} cells`);
