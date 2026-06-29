import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const defaultTreeSystemPath = resolve(here, "../src/trees/tree_system.ts");

const EDITS = [
  {
    label: "tree shadow group count import",
    expected: `  treeGpuRingGroupIndex,
  TREE_GPU_RING_GROUP_COUNT,
  treeGpuRingKey,`,
    replacement: `  treeGpuRingGroupIndex,
  TREE_GPU_RING_GROUP_COUNT,
  TREE_GPU_RING_SHADOW_GROUP_COUNT,
  treeGpuRingKey,`,
  },
  {
    label: "realtime shadow cascade imports",
    expected: `import type { EnvironmentLighting } from "../environment/environment.js";
import type { ForestLightingMaterialState } from "../forest_lighting/index.js";`,
    replacement: `import type { EnvironmentLighting } from "../environment/environment.js";
import { getRealtimeSunShadowCascadeCameras } from "../rendering/realtime_sun_shadows.js";
import type { ForestLightingMaterialState } from "../forest_lighting/index.js";
import { treeRingShadowCascadePlanesFromCameras } from "./tree_ring_shadow_casters.js";`,
  },
  {
    label: "tree GPU ring resource shadow fields",
    expected: `  cell: StorageInstancedBufferAttribute;
  indirect: StorageBufferAttribute;
  outputBuffers: TreeGpuRingOutputBuffers;`,
    replacement: `  cell: StorageInstancedBufferAttribute;
  indirect: StorageBufferAttribute;
  shadowCell: StorageInstancedBufferAttribute;
  shadowIndirect: StorageBufferAttribute;
  outputBuffers: TreeGpuRingOutputBuffers;`,
  },
  {
    label: "tree GPU ring shadow buffers allocation",
    expected: `    const indirect = new StorageBufferAttribute(new Uint32Array(TREE_GPU_RING_GROUP_COUNT * 5), 5);
    indirect.name = "tree-ring-indirect";
    this.gpuBackend.createIndirectStorageAttribute(indirect);
    const cell = this.createStorageInstancedAttribute("cell", sharedInstanceCount);
    const ringBuffers: TreeRingInstanceBuffers = { cell, capacity: sharedInstanceCount };`,
    replacement: `    const indirect = new StorageBufferAttribute(new Uint32Array(TREE_GPU_RING_GROUP_COUNT * 5), 5);
    indirect.name = "tree-ring-indirect";
    this.gpuBackend.createIndirectStorageAttribute(indirect);
    const cell = this.createStorageInstancedAttribute("cell", sharedInstanceCount);
    const shadowIndirect = new StorageBufferAttribute(new Uint32Array(TREE_GPU_RING_SHADOW_GROUP_COUNT * 5), 5);
    shadowIndirect.name = "tree-ring-shadow-indirect";
    this.gpuBackend.createIndirectStorageAttribute(shadowIndirect);
    const shadowCell = this.createStorageInstancedAttribute("shadow-cell", count * TREE_GPU_RING_SHADOW_GROUP_COUNT);
    const ringBuffers: TreeRingInstanceBuffers = { cell, capacity: sharedInstanceCount };`,
  },
  {
    label: "tree GPU ring shadow output buffers",
    expected: `      cell,
      indirect,
      materialHandles,
      outputBuffers: {
        cell: this.gpuBufferForAttribute(cell),
        indirectArgs: this.gpuBufferForAttribute(indirect),
      },`,
    replacement: `      cell,
      indirect,
      shadowCell,
      shadowIndirect,
      materialHandles,
      outputBuffers: {
        cell: this.gpuBufferForAttribute(cell),
        indirectArgs: this.gpuBufferForAttribute(indirect),
        shadowCell: this.gpuBufferForAttribute(shadowCell),
        shadowIndirectArgs: this.gpuBufferForAttribute(shadowIndirect),
      },`,
  },
  {
    label: "tree shadow cascade planes before dispatch",
    expected: `      const frustumPlanes = this.frustumPlanes(camera);
      const dispatched = this.gpuRingCompute.dispatch({`,
    replacement: `      const frustumPlanes = this.frustumPlanes(camera);
      const shadowCameras = getRealtimeSunShadowCascadeCameras();
      const shadowCascadePlanes = shadowCameras.length > 0 ? treeRingShadowCascadePlanesFromCameras(shadowCameras) : undefined;
      const dispatched = this.gpuRingCompute.dispatch({`,
  },
  {
    label: "tree shadow dispatch params",
    expected: `        maxInstancesPerGroup: treeGpuRingGroupCapacity(this.settings),
        indexCounts: this.gpuRingIndexCounts(),
        frustumPlanes,`,
    replacement: `        maxInstancesPerGroup: treeGpuRingGroupCapacity(this.settings),
        maxShadowCastersPerGroup: shadowCascadePlanes ? treeGpuRingGroupCapacity(this.settings) : 0,
        indexCounts: this.gpuRingIndexCounts(),
        frustumPlanes,
        shadowCascadePlanes,`,
  },
];

export function wireTreeSystemTree7Source(input) {
  const eol = detectEol(input);
  let source = normalizeEol(input);
  let changed = false;
  const applied = [];
  const skipped = [];

  for (const edit of EDITS) {
    const expectedCount = countOccurrences(source, edit.expected);
    const replacementCount = countOccurrences(source, edit.replacement);
    if (replacementCount === 1) {
      skipped.push(edit.label);
      continue;
    }
    if (replacementCount > 1 || expectedCount !== 1) {
      throw new Error(`Cannot apply ${edit.label}: expected ${expectedCount} source matches and ${replacementCount} already-applied matches.`);
    }
    source = source.replace(edit.expected, edit.replacement);
    changed = true;
    applied.push(edit.label);
  }

  return { source: restoreEol(source, eol), changed, applied, skipped };
}

export function wireTreeSystemTree7File(path = defaultTreeSystemPath, options = {}) {
  const source = readFileSync(path, "utf8");
  const result = wireTreeSystemTree7Source(source);
  if (options.dryRun) return result;
  if (result.changed) writeFileSync(path, result.source, "utf8");
  return result;
}

if (isCli()) {
  const dryRun = process.argv.includes("--dry-run");
  const result = wireTreeSystemTree7File(defaultTreeSystemPath, { dryRun });
  const mode = dryRun ? "Checked" : "Updated";
  console.log(`${mode} ${defaultTreeSystemPath}`);
  console.log(`Applied: ${result.applied.length ? result.applied.join(", ") : "none"}`);
  console.log(`Already present: ${result.skipped.length ? result.skipped.join(", ") : "none"}`);
}

function normalizeEol(source) {
  return source.replace(/\r\n/g, "\n");
}

function restoreEol(source, eol) {
  return eol === "\r\n" ? source.replace(/\n/g, "\r\n") : source;
}

function detectEol(source) {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

function isCli() {
  return process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
}
