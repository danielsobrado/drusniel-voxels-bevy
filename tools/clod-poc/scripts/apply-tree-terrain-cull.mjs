import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

function readProjectFile(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function checkNeedles(name, path, needles) {
  const source = readProjectFile(path);
  const missing = needles.filter((needle) => !source.includes(needle));
  return { name, status: missing.length === 0 ? "ok" : "missing", missing };
}

function checkComposedEarlyCullOrder() {
  const source = readProjectFile("src/gpu/wgsl_modules.test.ts");
  const needles = [
    "returns on terrain-hidden trees before visible and shadow appends",
    "expect(hiddenReturn).toBeLessThan(shadowAppend);",
    "expect(hiddenReturn).toBeLessThan(visibleAppend);",
  ];
  const missing = needles.filter((needle) => !source.includes(needle));
  return { name: "composed shader early cull order test", status: missing.length === 0 ? "ok" : "missing", missing };
}

function checkValidationEarlyCullOrder() {
  const source = readProjectFile("src/trees/tree_ring_lighting_proxies.ts");
  const terrainCull = source.indexOf("treeRingTerrainHiddenForValidation({");
  const shadowCount = source.indexOf("countShadowCasterGroups({");
  const valid = terrainCull >= 0 && shadowCount >= 0 && terrainCull < shadowCount;
  return {
    name: "CPU/GPU validation culls terrain before shadows",
    status: valid ? "ok" : "missing",
    missing: valid ? [] : ["terrain visibility check must appear before countShadowCasterGroups"],
  };
}

const results = [
  checkNeedles("shared vegetation visibility provider", "src/vegetation/vegetation_visibility_provider.ts", [
    "export interface VegetationVisibilityProvider",
    "sampleTerrainVisibility",
    "unknown_kept",
    "terrain_hidden",
    "near_forced_visible",
  ]),
  checkNeedles("tree config terrain visibility types", "src/trees/tree_config_types.ts", [
    "export interface TreeTerrainVisibilitySettings",
    "terrainVisibility: TreeTerrainVisibilitySettings;",
  ]),
  checkNeedles("tree config terrain visibility defaults", "src/trees/tree_config_defaults.ts", [
    "terrainVisibility: {",
    "minDistanceM: 96",
    "sampleCount: 6",
    "heightMarginM: 1.75",
    "crownHeightM: 5.5",
  ]),
  checkNeedles("tree config terrain visibility parsing", "src/trees/tree_config_parsing.ts", [
    "const terrainVisibilityRoot = record(gpuRoot.terrain_visibility);",
    "sampleCount: clampedIntFrom(terrainVisibilityRoot.sample_count",
    "terrainVisibility: parseGpu(roots.gpu, roots.terrainVisibility, fallback.gpu)",
  ]),
  checkNeedles("tree config terrain visibility cloning", "src/trees/tree_config_clone.ts", [
    "terrainVisibility: { ...settings.gpu.terrainVisibility }",
  ]),
  checkNeedles("compute terrain visibility uniform", "src/gpu/tree_ring_compute.ts", [
    "treeGpuRingTerrainVisibilityEnabled(settings)",
    "f32[27] = Number.isFinite(params.cameraY) ? params.cameraY : 0;",
    "f32[TREE_GPU_RING_LAYOUT.terrainVisibilityOffset] = treeGpuRingTerrainVisibilityEnabled(settings) ? 1 : 0;",
    "terrainVisibilityOffset",
    "terrainVisibilityUOffset",
    "terrainVisibilityCounts",
  ]),
  checkNeedles("composer terrain visibility support", "src/gpu/wgsl_modules.ts", [
    "withTreeTerrainVisibilityCull",
    "params.terrain_visibility.x > 0.5",
    "terrain_ridge_filter(wpos, height, dist)",
    "if (terrain_hidden) { return; }\\n  append_shadow_lod_if_active",
  ]),
  checkNeedles("CPU patch terrain visibility support", "src/trees/tree_system_cpu_runtime.ts", [
    "isTreeClusterTerrainOccluded",
    "patch.terrainOccluded",
    "treeTerrainOcclusionSettings",
  ]),
  checkComposedEarlyCullOrder(),
  checkValidationEarlyCullOrder(),
];

console.log(JSON.stringify(results, null, 2));

if (results.some((result) => result.status !== "ok")) {
  process.exitCode = 1;
}
