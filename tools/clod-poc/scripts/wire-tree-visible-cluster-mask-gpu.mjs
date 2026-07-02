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

function checkComposedOrder() {
  const source = readProjectFile("src/gpu/wgsl_modules.test.ts");
  const needles = [
    "culls terrain-hidden trees before shadows but keeps cluster cull visible-only",
    "expect(terrainReject).toBeLessThan(shadowAppend);",
    "expect(visibleReject).toBeGreaterThan(shadowAppend);",
    "expect(visibleReject).toBeLessThan(visibleAppend);",
  ];
  const missing = needles.filter((needle) => !source.includes(needle));
  return { name: "composed shader split cull order", status: missing.length === 0 ? "ok" : "missing", missing };
}

function checkTransformOrder() {
  const source = readProjectFile("src/gpu/tree_ring_wgsl_transforms.ts");
  const targetStart = source.indexOf("const targetOrder = `");
  const targetEnd = source.indexOf("`;", targetStart + 1);
  const target = targetStart >= 0 && targetEnd > targetStart ? source.slice(targetStart, targetEnd) : "";
  const terrainReject = target.indexOf("terrainRejectStmt");
  const visibleReject = target.indexOf("clusterRejectStmt");
  const shadowAppend = target.indexOf("shadowAppendFn}(species, TREE_LOD_NEAR");
  const visibleAppend = target.indexOf("visibleAppendFn}(species, TREE_LOD_NEAR");
  const valid = terrainReject >= 0 && shadowAppend >= 0 && visibleReject >= 0 && visibleAppend >= 0
    && terrainReject < shadowAppend && shadowAppend < visibleReject && visibleReject < visibleAppend;
  return {
    name: "transform keeps cluster cull visible-only",
    status: valid ? "ok" : "missing",
    missing: valid ? [] : ["expected terrain reject before shadows, cluster reject after shadows, and cluster reject before visible appends"],
  };
}

function checkRawShaderOrder() {
  const source = readProjectFile("src/gpu/shaders/tree_ring.compute.wgsl");
  const terrainReject = source.indexOf("if (terrain_hidden) { return; }");
  const shadowAppend = source.indexOf("append_shadow_lod_if_active(species, TREE_LOD_NEAR");
  const visibleAppend = source.indexOf("append_lod_if_active(species, TREE_LOD_NEAR");
  const valid = terrainReject >= 0 && shadowAppend >= 0 && visibleAppend >= 0
    && terrainReject < shadowAppend && terrainReject < visibleAppend;
  return {
    name: "raw shader culls terrain before shadows",
    status: valid ? "ok" : "missing",
    missing: valid ? [] : ["terrain-hidden return must happen before shadow and visible appends"],
  };
}

const results = [
  checkNeedles("GPU visible cluster buffers", "src/gpu/tree_ring_compute.ts", [
    "export const TREE_GPU_RING_STORAGE_BINDINGS = 9;",
    "visibleClusterMaskWords?: Uint32Array;",
    "activeSlotIndices?: Uint32Array;",
    "visibleClusterMaskBuffer",
    "activeSlotBuffer",
    "storage(11, \"read-only-storage\")",
    "storage(12, \"read-only-storage\")",
    "prepareActiveSlotIndices",
  ]),
  checkNeedles("runtime visible cluster mask", "src/trees/tree_system_gpu_ring_runtime.ts", [
    "buildTreeRingClusterVisibilityMask",
    "visibleClusterMaskWords: visibleClusterMask?.words",
    "visibleClusterDimCells: visibleClusterMask?.clusterDimCells",
    "visibleClusterGrid: visibleClusterMask?.clusterGrid",
    "activeSlotIndices: visibleClusterMask?.activeSlotIndices",
  ]),
  checkNeedles("WGSL visible cluster transform", "src/gpu/tree_ring_wgsl_transforms.ts", [
    "var<storage, read> tree_visible_cluster_mask: array<u32>;",
    "var<storage, read> tree_active_slot_indices: array<u32>;",
    "fn tree_slot_visible_cluster_visible(slot: u32) -> bool",
    "if (!tree_slot_visible_cluster_visible(slot)) { return; }",
    "let slot = tree_active_slot_indices[id.x];",
  ]),
  checkRawShaderOrder(),
  checkTransformOrder(),
  checkComposedOrder(),
];

console.log(JSON.stringify({ results }, null, 2));

if (results.some((result) => result.status !== "ok")) {
  process.exitCode = 1;
}
