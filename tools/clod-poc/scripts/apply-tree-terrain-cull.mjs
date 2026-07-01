import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const checks = [
  {
    name: "shared vegetation visibility provider",
    path: "src/vegetation/vegetation_visibility_provider.ts",
    needles: [
      "export interface VegetationVisibilityProvider",
      "sampleTerrainVisibility",
      "unknown_kept",
      "terrain_hidden",
      "near_forced_visible",
    ],
  },
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
    name: "raw shader terrain visibility support",
    path: "src/gpu/shaders/tree_ring.compute.wgsl",
    needles: [
      "fn tree_terrain_visibility_enabled() -> bool",
      "fn record_tree_terrain_visibility(terrain_hidden: bool)",
      "terrain_ridge_filter(wpos, height, dist)",
      "TREE_TERRAIN_HIDDEN_COUNTER",
    ],
  },
  {
    name: "composer terrain visibility support",
    path: "src/gpu/wgsl_modules.ts",
    needles: [
      "withTreeTerrainVisibilityCull",
      "params.terrain_visibility.x > 0.5",
      "terrain_ridge_filter(wpos, height, dist)",
    ],
  },
  {
    name: "CPU patch terrain visibility support",
    path: "src/trees/tree_system_cpu_runtime.ts",
    needles: [
      "isTreeClusterTerrainOccluded",
      "patch.terrainOccluded",
      "treeTerrainOcclusionSettings",
    ],
  },
];

function readProjectFile(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function checkNeedles(check) {
  const source = readProjectFile(check.path);
  const missing = check.needles.filter((needle) => !source.includes(needle));
  return { name: check.name, status: missing.length === 0 ? "ok" : "missing", missing };
}

function checkComposedShadowOrder() {
  const source = readProjectFile("src/gpu/wgsl_modules.test.ts");
  const needles = [
    "skips visible and shadow appends for terrain hidden tree candidates",
    "expect(hiddenReturn).toBeLessThan(shadowAppend);",
    "expect(hiddenReturn).toBeLessThan(visibleAppend);",
  ];
  const missing = needles.filter((needle) => !source.includes(needle));
  return { name: "composed shader shadow order test", status: missing.length === 0 ? "ok" : "missing", missing };
}

const results = [...checks.map(checkNeedles), checkComposedShadowOrder()];
console.log(JSON.stringify(results, null, 2));

if (results.some((result) => result.status !== "ok")) {
  process.exitCode = 1;
}
