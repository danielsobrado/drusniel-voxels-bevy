import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const shaderPath = resolve(root, "src/gpu/shaders/tree_ring.compute.wgsl");
const testPath = resolve(root, "src/gpu/wgsl_modules.test.ts");
const computePath = resolve(root, "src/gpu/tree_ring_compute.ts");
const configPath = resolve(root, "src/trees/tree_config.ts");

const patches = [
  {
    name: "tree config interface",
    path: configPath,
    done: "terrainVisibility: TreeTerrainVisibilitySettings;",
    needle: `export interface TreeGpuSettings {
  enabled: boolean;
  preferWebGpu: boolean;
  fallbackToCpu: boolean;
  scatterEnabled: boolean;
  cullEnabled: boolean;
  maxVisible: number;
  workgroupSize: number;
  readbackVisibleLists: boolean;
  debugForceCpu: boolean;
  debugShowGpuCounts: boolean;
  debugValidateAgainstCpu: boolean;
}
`,
    replacement: `export interface TreeTerrainVisibilitySettings {
  enabled: boolean;
  minDistanceM: number;
  sampleCount: number;
  heightMarginM: number;
  crownHeightM: number;
  cullVisible: boolean;
  cullShadows: boolean;
}

export interface TreeGpuSettings {
  enabled: boolean;
  preferWebGpu: boolean;
  fallbackToCpu: boolean;
  scatterEnabled: boolean;
  cullEnabled: boolean;
  maxVisible: number;
  workgroupSize: number;
  readbackVisibleLists: boolean;
  debugForceCpu: boolean;
  debugShowGpuCounts: boolean;
  debugValidateAgainstCpu: boolean;
  terrainVisibility: TreeTerrainVisibilitySettings;
}
`,
  },
  {
    name: "tree config defaults",
    path: configPath,
    done: "terrainVisibility: {",
    needle: `export const DEFAULT_TREE_GPU_SETTINGS: TreeGpuSettings = {
  enabled: true,
  preferWebGpu: true,
  fallbackToCpu: true,
  scatterEnabled: true,
  cullEnabled: true,
  maxVisible: 50_000,
  workgroupSize: 64,
  readbackVisibleLists: false,
  debugForceCpu: false,
  debugShowGpuCounts: false,
  debugValidateAgainstCpu: false,
};`,
    replacement: `export const DEFAULT_TREE_GPU_SETTINGS: TreeGpuSettings = {
  enabled: true,
  preferWebGpu: true,
  fallbackToCpu: true,
  scatterEnabled: true,
  cullEnabled: true,
  maxVisible: 50_000,
  workgroupSize: 64,
  readbackVisibleLists: false,
  debugForceCpu: false,
  debugShowGpuCounts: false,
  debugValidateAgainstCpu: false,
  terrainVisibility: {
    enabled: true,
    minDistanceM: 96,
    sampleCount: 6,
    heightMarginM: 1.75,
    crownHeightM: 5.5,
    cullVisible: true,
    cullShadows: true,
  },
};`,
  },
  {
    name: "tree config root",
    path: configPath,
    done: "const terrainVisibilityRoot = record(gpuRoot.terrain_visibility);",
    needle: `    const gpuRoot = record(trees.gpu);
    const speciesRoot = record(trees.species);`,
    replacement: `    const gpuRoot = record(trees.gpu);
    const terrainVisibilityRoot = record(gpuRoot.terrain_visibility);
    const speciesRoot = record(trees.species);`,
  },
  {
    name: "tree config parser",
    path: configPath,
    done: "minDistanceM: Math.max(0, numberFrom(terrainVisibilityRoot.min_distance_m",
    needle: `        debugForceCpu: boolFrom(gpuRoot.debug_force_cpu, fallback.gpu.debugForceCpu),
        debugShowGpuCounts: boolFrom(gpuRoot.debug_show_gpu_counts, fallback.gpu.debugShowGpuCounts),
        debugValidateAgainstCpu: boolFrom(gpuRoot.debug_validate_against_cpu, fallback.gpu.debugValidateAgainstCpu),
      },`,
    replacement: `        debugForceCpu: boolFrom(gpuRoot.debug_force_cpu, fallback.gpu.debugForceCpu),
        debugShowGpuCounts: boolFrom(gpuRoot.debug_show_gpu_counts, fallback.gpu.debugShowGpuCounts),
        debugValidateAgainstCpu: boolFrom(gpuRoot.debug_validate_against_cpu, fallback.gpu.debugValidateAgainstCpu),
        terrainVisibility: {
          enabled: boolFrom(terrainVisibilityRoot.enabled, fallback.gpu.terrainVisibility.enabled),
          minDistanceM: Math.max(0, numberFrom(terrainVisibilityRoot.min_distance_m, fallback.gpu.terrainVisibility.minDistanceM)),
          sampleCount: clampedIntFrom(terrainVisibilityRoot.sample_count, fallback.gpu.terrainVisibility.sampleCount, 1, 16),
          heightMarginM: Math.max(0, numberFrom(terrainVisibilityRoot.height_margin_m, fallback.gpu.terrainVisibility.heightMarginM)),
          crownHeightM: Math.max(0, numberFrom(terrainVisibilityRoot.crown_height_m, fallback.gpu.terrainVisibility.crownHeightM)),
          cullVisible: boolFrom(terrainVisibilityRoot.cull_visible, fallback.gpu.terrainVisibility.cullVisible),
          cullShadows: boolFrom(terrainVisibilityRoot.cull_shadows, fallback.gpu.terrainVisibility.cullShadows),
        },
      },`,
  },
  {
    name: "compute helper",
    path: computePath,
    done: "treeGpuRingTerrainVisibilityEnabled",
    needle: `export function treeGpuRingShadowMaxLodIndex(settings: TreeSettings): number {
  const maxLod = settings.lod.shadowsMaxLod;
  return maxLod === "none" ? SHADOW_MAX_LOD_NONE : TREE_LODS.indexOf(maxLod);
}
`,
    replacement: `export function treeGpuRingShadowMaxLodIndex(settings: TreeSettings): number {
  const maxLod = settings.lod.shadowsMaxLod;
  return maxLod === "none" ? SHADOW_MAX_LOD_NONE : TREE_LODS.indexOf(maxLod);
}

export function treeGpuRingTerrainVisibilityEnabled(settings: TreeSettings): boolean {
  return settings.gpu.terrainVisibility?.enabled !== false;
}
`,
  },
  {
    name: "compute uniform flag",
    path: computePath,
    done: "f32[27] = treeGpuRingTerrainVisibilityEnabled(settings) ? 1 : 0;",
    needle: `  f32[26] = treeGpuRingShadowMaxLodIndex(settings);`,
    replacement: `  f32[26] = treeGpuRingShadowMaxLodIndex(settings);
  f32[27] = treeGpuRingTerrainVisibilityEnabled(settings) ? 1 : 0;`,
  },
  {
    name: "raw shader helper",
    path: shaderPath,
    done: "fn tree_terrain_visibility_enabled() -> bool",
    needle: `fn terrain_ridge_filter(end_xz: vec2<f32>, end_height: f32, distance_m: f32) -> bool {`,
    replacement: `fn tree_terrain_visibility_enabled() -> bool {
  return params.settings_e.w > 0.5;
}

fn terrain_ridge_filter(end_xz: vec2<f32>, end_height: f32, distance_m: f32) -> bool {`,
  },
  {
    name: "raw shader cull",
    path: shaderPath,
    done: "tree_terrain_visibility_enabled() && terrain_ridge_filter(wpos, height, dist)",
    needle: `  let shadow_center = vec3<f32>(wpos.x, height + 4.0, wpos.y);
  append_shadow_lod_if_active`,
    replacement: `  let shadow_center = vec3<f32>(wpos.x, height + 4.0, wpos.y);
  if (tree_terrain_visibility_enabled() && terrain_ridge_filter(wpos, height, dist)) { return; }
  append_shadow_lod_if_active`,
  },
];

function applyPatch({ name, path, done, needle, replacement }) {
  const source = readFileSync(path, "utf8");
  if (source.includes(done) || source.includes(replacement)) return { name, status: "already-applied" };
  if (!source.includes(needle)) return { name, status: "skipped-anchor-missing" };
  writeFileSync(path, source.replace(needle, replacement));
  return { name, status: "applied" };
}

function ensureTreeTestExpectation() {
  const source = readFileSync(testPath, "utf8");
  const expectedA = `    expect(source).toContain("tree_terrain_visibility_enabled()");`;
  const expectedB = `    expect(source).toContain("terrain_ridge_filter(wpos, height, dist)");`;
  if (source.includes(expectedA) && source.includes(expectedB)) return { name: "wgsl test expectation", status: "already-applied" };
  const anchor = `    expect(source).toContain("let normal_y = tree_height_normal_y(wpos);");`;
  if (!source.includes(anchor)) return { name: "wgsl test expectation", status: "skipped-anchor-missing" };
  writeFileSync(testPath, source.replace(anchor, `${anchor}\n${expectedA}\n${expectedB}`));
  return { name: "wgsl test expectation", status: "applied" };
}

const results = patches.map(applyPatch);
results.push(ensureTreeTestExpectation());

console.log(JSON.stringify(results, null, 2));
