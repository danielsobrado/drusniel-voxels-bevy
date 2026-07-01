import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const checks = [
  {
    name: "tree config terrain visibility settings",
    path: "src/trees/tree_config.ts",
    needles: [
      "export interface TreeTerrainVisibilitySettings",
      "terrainVisibility: TreeTerrainVisibilitySettings;",
      "const terrainVisibilityRoot = record(gpuRoot.terrain_visibility);",
      "sampleCount: clampedIntFrom(terrainVisibilityRoot.sample_count",
      "terrainVisibility: { ...settings.gpu.terrainVisibility }",
    ],
  },
  {
    name: "compute terrain visibility uniform",
    path: "src/gpu/tree_ring_compute.ts",
    needles: [
      "treeGpuRingTerrainVisibilityEnabled(settings)",
      "f32[27] = Number.isFinite(params.cameraY) ? params.cameraY : 0;",
      "f32[TREE_GPU_RING_LAYOUT.terrainVisibilityOffset] = treeGpuRingTerrainVisibilityEnabled(settings) ? 1 : 0;",
      "terrainVisibilityOffset",
      "terrainVisibilityUOffset",
      "terrainVisibilityCounts",
    ],
  },
  {
    name: "raw shader terrain visibility cull",
    path: "src/gpu/shaders/tree_ring.compute.wgsl",
    needles: [
      "fn tree_terrain_visibility_enabled() -> bool",
      "fn record_tree_terrain_visibility(terrain_hidden: bool)",
      "terrain_ridge_filter(wpos, height, dist)",
      "TREE_TERRAIN_HIDDEN_COUNTER",
      "if (terrain_hidden) { return; }",
    ],
  },
  {
    name: "composer terrain visibility cull",
    path: "src/gpu/wgsl_modules.ts",
    needles: [
      "withTreeTerrainVisibilityCull",
      "params.terrain_visibility.x > 0.5",
      "terrain_ridge_filter(wpos, height, dist)",
    ],
  },
  {
    name: "CPU patch terrain culling",
    path: "src/trees/tree_system_cpu_runtime.ts",
    needles: [
      "isTreeClusterTerrainOccluded",
      "patch.terrainOccluded",
      "treeTerrainOcclusionSettings",
    ],
  },
];

const results = checks.map((check) => {
  const source = readFileSync(resolve(root, check.path), "utf8");
  const missing = check.needles.filter((needle) => !source.includes(needle));
  return { name: check.name, status: missing.length === 0 ? "ok" : "missing", missing };
});

console.log(JSON.stringify(results, null, 2));

if (results.some((result) => result.status !== "ok")) {
  process.exitCode = 1;
}
