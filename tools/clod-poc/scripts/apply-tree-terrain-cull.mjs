import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const shaderPath = resolve(root, "src/gpu/shaders/tree_ring.compute.wgsl");
const testPath = resolve(root, "src/gpu/wgsl_modules.test.ts");

const shaderNeedle = `  let shadow_center = vec3<f32>(wpos.x, height + 4.0, wpos.y);\n  append_shadow_lod_if_active`;
const shaderReplacement = `  let shadow_center = vec3<f32>(wpos.x, height + 4.0, wpos.y);\n  if (terrain_ridge_filter(wpos, height, dist)) { return; }\n  append_shadow_lod_if_active`;

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
  const expected = `    expect(source).toContain("terrain_ridge_filter(wpos, height, dist)");`;
  if (source.includes(expected)) return false;
  const anchor = `    expect(source).toContain("let normal_y = tree_height_normal_y(wpos);");`;
  if (!source.includes(anchor)) throw new Error(`Patch anchor not found in ${testPath}`);
  writeFileSync(testPath, source.replace(anchor, `${anchor}\n${expected}`));
  return true;
}

const shaderChanged = replaceOnce(shaderPath, shaderNeedle, shaderReplacement);
const testChanged = ensureTreeTestExpectation();

console.log(JSON.stringify({ shaderChanged, testChanged }, null, 2));
