import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const shaderPath = resolve(root, "src/gpu/shaders/tree_ring.compute.wgsl");
const testPath = resolve(root, "src/gpu/wgsl_modules.test.ts");
const computePath = resolve(root, "src/gpu/tree_ring_compute.ts");

const shaderNeedle = `  let shadow_center = vec3<f32>(wpos.x, height + 4.0, wpos.y);\n  append_shadow_lod_if_active`;
const shaderReplacement = `  let shadow_center = vec3<f32>(wpos.x, height + 4.0, wpos.y);\n  if (tree_terrain_visibility_enabled() && terrain_ridge_filter(wpos, height, dist)) { return; }\n  append_shadow_lod_if_active`;

const shaderHelperNeedle = `fn terrain_ridge_filter(end_xz: vec2<f32>, end_height: f32, distance_m: f32) -> bool {`;
const shaderHelperReplacement = `fn tree_terrain_visibility_enabled() -> bool {\n  return params.settings_e.w > 0.5;\n}\n\nfn terrain_ridge_filter(end_xz: vec2<f32>, end_height: f32, distance_m: f32) -> bool {`;

const computeNeedle = `  f32[26] = treeGpuRingShadowMaxLodIndex(settings);`;
const computeReplacement = `  f32[26] = treeGpuRingShadowMaxLodIndex(settings);\n  f32[27] = treeGpuRingTerrainVisibilityEnabled(settings) ? 1 : 0;`;

const computeHelperNeedle = `export function treeGpuRingShadowMaxLodIndex(settings: TreeSettings): number {\n  const maxLod = settings.lod.shadowsMaxLod;\n  return maxLod === "none" ? SHADOW_MAX_LOD_NONE : TREE_LODS.indexOf(maxLod);\n}\n`;
const computeHelperReplacement = `export function treeGpuRingShadowMaxLodIndex(settings: TreeSettings): number {\n  const maxLod = settings.lod.shadowsMaxLod;\n  return maxLod === "none" ? SHADOW_MAX_LOD_NONE : TREE_LODS.indexOf(maxLod);\n}\n\nexport function treeGpuRingTerrainVisibilityEnabled(settings: TreeSettings): boolean {\n  const gpu = settings.gpu as TreeSettings["gpu"] & { terrainVisibility?: { enabled?: boolean } };\n  return gpu.terrainVisibility?.enabled !== false;\n}\n`;

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

const shaderHelperChanged = replaceOnce(shaderPath, shaderHelperNeedle, shaderHelperReplacement);
const shaderChanged = replaceOnce(shaderPath, shaderNeedle, shaderReplacement);
const computeHelperChanged = replaceOnce(computePath, computeHelperNeedle, computeHelperReplacement);
const computeChanged = replaceOnce(computePath, computeNeedle, computeReplacement);
const testChanged = ensureTreeTestExpectation();

console.log(JSON.stringify({ shaderHelperChanged, shaderChanged, computeHelperChanged, computeChanged, testChanged }, null, 2));
