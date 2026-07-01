import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const shaderPath = resolve(root, "src/gpu/shaders/tree_ring.compute.wgsl");
const testPath = resolve(root, "src/gpu/wgsl_modules.test.ts");
const computePath = resolve(root, "src/gpu/tree_ring_compute.ts");
const configPath = resolve(root, "src/trees/tree_config.ts");

const shaderNeedle = `  let shadow_center = vec3<f32>(wpos.x, height + 4.0, wpos.y);\n  append_shadow_lod_if_active`;
const shaderReplacement = `  let shadow_center = vec3<f32>(wpos.x, height + 4.0, wpos.y);\n  if (tree_terrain_visibility_enabled() && terrain_ridge_filter(wpos, height, dist)) { return; }\n  append_shadow_lod_if_active`;

const shaderHelperNeedle = `fn terrain_ridge_filter(end_xz: vec2<f32>, end_height: f32, distance_m: f32) -> bool {`;
const shaderHelperReplacement = `fn tree_terrain_visibility_enabled() -> bool {\n  return params.settings_e.w > 0.5;\n}\n\nfn terrain_ridge_filter(end_xz: vec2<f32>, end_height: f32, distance_m: f32) -> bool {`;

const computeNeedle = `  f32[26] = treeGpuRingShadowMaxLodIndex(settings);`;
const computeReplacement = `  f32[26] = treeGpuRingShadowMaxLodIndex(settings);\n  f32[27] = treeGpuRingTerrainVisibilityEnabled(settings) ? 1 : 0;`;

const computeHelperNeedle = `export function treeGpuRingShadowMaxLodIndex(settings: TreeSettings): number {\n  const maxLod = settings.lod.shadowsMaxLod;\n  return maxLod === "none" ? SHADOW_MAX_LOD_NONE : TREE_LODS.indexOf(maxLod);\n}\n`;
const computeHelperReplacement = `export function treeGpuRingShadowMaxLodIndex(settings: TreeSettings): number {\n  const maxLod = settings.lod.shadowsMaxLod;\n  return maxLod === "none" ? SHADOW_MAX_LOD_NONE : TREE_LODS.indexOf(maxLod);\n}\n\nexport function treeGpuRingTerrainVisibilityEnabled(settings: TreeSettings): boolean {\n  return settings.gpu.terrainVisibility.enabled;\n}\n`;

const configInterfaceNeedle = `export interface TreeGpuSettings {\n  enabled: boolean;\n  preferWebGpu: boolean;\n  fallbackToCpu: boolean;\n  scatterEnabled: boolean;\n  cullEnabled: boolean;\n  maxVisible: number;\n  workgroupSize: number;\n  readbackVisibleLists: boolean;\n  debugForceCpu: boolean;\n  debugShowGpuCounts: boolean;\n  debugValidateAgainstCpu: boolean;\n}\n`;
const configInterfaceReplacement = `export interface TreeTerrainVisibilitySettings {\n  enabled: boolean;\n  minDistanceM: number;\n  sampleCount: number;\n  heightMarginM: number;\n  crownHeightM: number;\n  cullVisible: boolean;\n  cullShadows: boolean;\n}\n\nexport interface TreeGpuSettings {\n  enabled: boolean;\n  preferWebGpu: boolean;\n  fallbackToCpu: boolean;\n  scatterEnabled: boolean;\n  cullEnabled: boolean;\n  maxVisible: number;\n  workgroupSize: number;\n  readbackVisibleLists: boolean;\n  debugForceCpu: boolean;\n  debugShowGpuCounts: boolean;\n  debugValidateAgainstCpu: boolean;\n  terrainVisibility: TreeTerrainVisibilitySettings;\n}\n`;

const configDefaultNeedle = `export const DEFAULT_TREE_GPU_SETTINGS: TreeGpuSettings = {\n  enabled: true,\n  preferWebGpu: true,\n  fallbackToCpu: true,\n  scatterEnabled: true,\n  cullEnabled: true,\n  maxVisible: 50_000,\n  workgroupSize: 64,\n  readbackVisibleLists: false,\n  debugForceCpu: false,\n  debugShowGpuCounts: false,\n  debugValidateAgainstCpu: false,\n};`;
const configDefaultReplacement = `export const DEFAULT_TREE_GPU_SETTINGS: TreeGpuSettings = {\n  enabled: true,\n  preferWebGpu: true,\n  fallbackToCpu: true,\n  scatterEnabled: true,\n  cullEnabled: true,\n  maxVisible: 50_000,\n  workgroupSize: 64,\n  readbackVisibleLists: false,\n  debugForceCpu: false,\n  debugShowGpuCounts: false,\n  debugValidateAgainstCpu: false,\n  terrainVisibility: {\n    enabled: true,\n    minDistanceM: 96,\n    sampleCount: 6,\n    heightMarginM: 1.75,\n    crownHeightM: 5.5,\n    cullVisible: true,\n    cullShadows: true,\n  },\n};`;

const configRootNeedle = `    const gpuRoot = record(trees.gpu);\n    const speciesRoot = record(trees.species);`;
const configRootReplacement = `    const gpuRoot = record(trees.gpu);\n    const terrainVisibilityRoot = record(gpuRoot.terrain_visibility);\n    const speciesRoot = record(trees.species);`;

const configParseNeedle = `        debugForceCpu: boolFrom(gpuRoot.debug_force_cpu, fallback.gpu.debugForceCpu),\n        debugShowGpuCounts: boolFrom(gpuRoot.debug_show_gpu_counts, fallback.gpu.debugShowGpuCounts),\n        debugValidateAgainstCpu: boolFrom(gpuRoot.debug_validate_against_cpu, fallback.gpu.debugValidateAgainstCpu),\n      },`;
const configParseReplacement = `        debugForceCpu: boolFrom(gpuRoot.debug_force_cpu, fallback.gpu.debugForceCpu),\n        debugShowGpuCounts: boolFrom(gpuRoot.debug_show_gpu_counts, fallback.gpu.debugShowGpuCounts),\n        debugValidateAgainstCpu: boolFrom(gpuRoot.debug_validate_against_cpu, fallback.gpu.debugValidateAgainstCpu),\n        terrainVisibility: {\n          enabled: boolFrom(terrainVisibilityRoot.enabled, fallback.gpu.terrainVisibility.enabled),\n          minDistanceM: Math.max(0, numberFrom(terrainVisibilityRoot.min_distance_m, fallback.gpu.terrainVisibility.minDistanceM)),\n          sampleCount: clampedIntFrom(terrainVisibilityRoot.sample_count, fallback.gpu.terrainVisibility.sampleCount, 1, 16),\n          heightMarginM: Math.max(0, numberFrom(terrainVisibilityRoot.height_margin_m, fallback.gpu.terrainVisibility.heightMarginM)),\n          crownHeightM: Math.max(0, numberFrom(terrainVisibilityRoot.crown_height_m, fallback.gpu.terrainVisibility.crownHeightM)),\n          cullVisible: boolFrom(terrainVisibilityRoot.cull_visible, fallback.gpu.terrainVisibility.cullVisible),\n          cullShadows: boolFrom(terrainVisibilityRoot.cull_shadows, fallback.gpu.terrainVisibility.cullShadows),\n        },\n      },`;

function replaceOnce(path, needle, replacement) {
  const source = readFileSync(path, "utf8");
  if (source.includes(replacement)) return false;
  if (!source.includes(needle)) {
    throw new Error(`Patch anchor not found in ${path}`);
  }
  writeFileSync(path, source.replace(needle, replacement));
  return true;
}

function ensureTreeTestExpectation() {
  const source = readFileSync(testPath, "utf8");
  const expected = `    expect(source).toContain("tree_terrain_visibility_enabled()");\n    expect(source).toContain("terrain_ridge_filter(wpos, height, dist)");`;
  if (source.includes(expected)) return false;
  const anchor = `    expect(source).toContain("let normal_y = tree_height_normal_y(wpos);");`;
  if (!source.includes(anchor)) throw new Error(`Patch anchor not found in ${testPath}`);
  writeFileSync(testPath, source.replace(anchor, `${anchor}\n${expected}`));
  return true;
}

const configInterfaceChanged = replaceOnce(configPath, configInterfaceNeedle, configInterfaceReplacement);
const configDefaultChanged = replaceOnce(configPath, configDefaultNeedle, configDefaultReplacement);
const configRootChanged = replaceOnce(configPath, configRootNeedle, configRootReplacement);
const configParseChanged = replaceOnce(configPath, configParseNeedle, configParseReplacement);
const shaderHelperChanged = replaceOnce(shaderPath, shaderHelperNeedle, shaderHelperReplacement);
const shaderChanged = replaceOnce(shaderPath, shaderNeedle, shaderReplacement);
const computeHelperChanged = replaceOnce(computePath, computeHelperNeedle, computeHelperReplacement);
const computeChanged = replaceOnce(computePath, computeNeedle, computeReplacement);
const testChanged = ensureTreeTestExpectation();

console.log(JSON.stringify({
  configInterfaceChanged,
  configDefaultChanged,
  configRootChanged,
  configParseChanged,
  shaderHelperChanged,
  shaderChanged,
  computeHelperChanged,
  computeChanged,
  testChanged,
}, null, 2));
