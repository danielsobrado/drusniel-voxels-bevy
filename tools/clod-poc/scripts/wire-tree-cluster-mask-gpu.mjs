import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const computePath = resolve(root, "src/gpu/tree_ring_compute.ts");
const modulesPath = resolve(root, "src/gpu/wgsl_modules.ts");
const runtimePath = resolve(root, "src/trees/tree_system_gpu_ring_runtime.ts");
const testPath = resolve(root, "src/gpu/tree_ring_compute.test.ts");

const edits = [
  {
    name: "storage binding count",
    path: computePath,
    done: "export const TREE_GPU_RING_STORAGE_BINDINGS = 8;",
    needle: "export const TREE_GPU_RING_STORAGE_BINDINGS = 7;",
    replacement: "export const TREE_GPU_RING_STORAGE_BINDINGS = 8;",
  },
  {
    name: "dispatch params cluster mask",
    path: computePath,
    done: "clusterVisibilityWords?: Uint32Array;",
    needle: "  shadowCascadePlanes?: ArrayLike<number>;\n}",
    replacement: "  shadowCascadePlanes?: ArrayLike<number>;\n  clusterVisibilityWords?: Uint32Array;\n  clusterDimCells?: number;\n  clusterGrid?: number;\n}",
  },
  {
    name: "pack cluster mask metadata",
    path: computePath,
    done: "u32[TREE_GPU_RING_LAYOUT.terrainVisibilityUOffset + 2] = Math.max(1, Math.floor(params.clusterDimCells ?? 0)) >>> 0;",
    needle: "  u32[TREE_GPU_RING_LAYOUT.terrainVisibilityUOffset] = Math.max(1, Math.min(16, Math.floor(settings.gpu.terrainVisibility.sampleCount))) >>> 0;",
    replacement: "  u32[TREE_GPU_RING_LAYOUT.terrainVisibilityUOffset] = Math.max(1, Math.min(16, Math.floor(settings.gpu.terrainVisibility.sampleCount))) >>> 0;\n  u32[TREE_GPU_RING_LAYOUT.terrainVisibilityUOffset + 2] = Math.max(1, Math.floor(params.clusterDimCells ?? 0)) >>> 0;\n  u32[TREE_GPU_RING_LAYOUT.terrainVisibilityUOffset + 3] = Math.max(0, Math.floor(params.clusterGrid ?? 0)) >>> 0;",
  },
  {
    name: "compute cluster buffer fields",
    path: computePath,
    done: "private readonly clusterVisibilityBuffer: GPUBuffer;",
    needle: "  private readonly shadowCounterBuffer: GPUBuffer;",
    replacement: "  private readonly shadowCounterBuffer: GPUBuffer;\n  private readonly clusterVisibilityBuffer: GPUBuffer;\n  private readonly clusterVisibilityWordCapacity: number;",
  },
  {
    name: "compute cluster buffer create",
    path: computePath,
    done: "label: \"tree ring cluster visibility\"",
    needle: "    this.shadowOutputsReady = !!outputBuffers.shadowCell && !!outputBuffers.shadowIndirectArgs;\n    this.paramBuffer = device.createBuffer",
    replacement: "    this.shadowOutputsReady = !!outputBuffers.shadowCell && !!outputBuffers.shadowIndirectArgs;\n    this.clusterVisibilityWordCapacity = treeGpuRingSlotCount(settings);\n    this.clusterVisibilityBuffer = device.createBuffer({ label: \"tree ring cluster visibility\", size: Math.max(1, this.clusterVisibilityWordCapacity) * Uint32Array.BYTES_PER_ELEMENT, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });\n    this.paramBuffer = device.createBuffer",
  },
  {
    name: "compute cluster bind entry",
    path: computePath,
    done: "{ binding: 11, resource: { buffer: this.clusterVisibilityBuffer } }",
    needle: "        { binding: 10, resource: hydroSampler },\n      ],",
    replacement: "        { binding: 10, resource: hydroSampler },\n        { binding: 11, resource: { buffer: this.clusterVisibilityBuffer } },\n      ],",
  },
  {
    name: "compute cluster layout entry",
    path: computePath,
    done: "storage(11, \"read-only-storage\")",
    needle: "        { binding: 10, visibility: GPUShaderStage.COMPUTE, sampler: {} },\n      ],",
    replacement: "        { binding: 10, visibility: GPUShaderStage.COMPUTE, sampler: {} },\n        storage(11, \"read-only-storage\"),\n      ],",
  },
  {
    name: "compute cluster upload",
    path: computePath,
    done: "effectiveParams.clusterVisibilityWords.buffer",
    needle: "    packTreeGpuRingParams(this.settings, effectiveParams, this.paramScratch);\n    new Uint32Array(this.paramScratch)[TREE_GPU_RING_LAYOUT.terrainVisibilityUOffset + 1] = readbackSlot ? 1 : 0;\n    this.device.queue.writeBuffer(this.paramBuffer, 0, this.paramScratch);",
    replacement: "    packTreeGpuRingParams(this.settings, effectiveParams, this.paramScratch);\n    const u32 = new Uint32Array(this.paramScratch);\n    u32[TREE_GPU_RING_LAYOUT.terrainVisibilityUOffset + 1] = readbackSlot ? 1 : 0;\n    if (effectiveParams.clusterVisibilityWords && effectiveParams.clusterVisibilityWords.length > 0) {\n      const wordCount = Math.min(effectiveParams.clusterVisibilityWords.length, this.clusterVisibilityWordCapacity);\n      this.device.queue.writeBuffer(\n        this.clusterVisibilityBuffer,\n        0,\n        effectiveParams.clusterVisibilityWords.buffer,\n        effectiveParams.clusterVisibilityWords.byteOffset,\n        wordCount * Uint32Array.BYTES_PER_ELEMENT,\n      );\n    } else {\n      u32[TREE_GPU_RING_LAYOUT.terrainVisibilityUOffset + 3] = 0;\n    }\n    this.device.queue.writeBuffer(this.paramBuffer, 0, this.paramScratch);",
  },
  {
    name: "compute cluster destroy",
    path: computePath,
    done: "this.clusterVisibilityBuffer.destroy();",
    needle: "    this.shadowCounterBuffer.destroy();",
    replacement: "    this.shadowCounterBuffer.destroy();\n    this.clusterVisibilityBuffer.destroy();",
  },
  {
    name: "wgsl cluster binding injection",
    path: modulesPath,
    done: "var<storage, read> tree_cluster_visibility: array<u32>;",
    needle: "fn tree_terrain_visibility_enabled() -> bool {",
    replacement: "@group(0) @binding(11) var<storage, read> tree_cluster_visibility: array<u32>;\n\nfn tree_terrain_visibility_enabled() -> bool {",
  },
  {
    name: "wgsl cluster helper injection",
    path: modulesPath,
    done: "fn tree_slot_cluster_visible(slot: u32) -> bool",
    needle: "fn tree_terrain_visibility_enabled() -> bool {\n  return params.terrain_visibility.x > 0.5;\n}",
    replacement: "fn tree_terrain_visibility_enabled() -> bool {\n  return params.terrain_visibility.x > 0.5;\n}\n\nfn tree_slot_cluster_visible(slot: u32) -> bool {\n  let cluster_grid = params.terrain_visibility_u.w;\n  if (cluster_grid == 0u) { return true; }\n  let cluster_dim = max(1u, params.terrain_visibility_u.z);\n  let grid = max(1u, params.settings_u.y);\n  let slot_x = slot % grid;\n  let slot_z = slot / grid;\n  let cluster_x = min(cluster_grid - 1u, slot_x / cluster_dim);\n  let cluster_z = min(cluster_grid - 1u, slot_z / cluster_dim);\n  return tree_cluster_visibility[cluster_z * cluster_grid + cluster_x] != 0u;\n}",
  },
  {
    name: "wgsl early cluster skip",
    path: modulesPath,
    done: "if (!tree_slot_cluster_visible(slot)) { return; }",
    needle: "  if (tree_hydrology_reject_tree(hydro, height, cfg)) { return; }",
    replacement: "  if (!tree_slot_cluster_visible(slot)) { return; }\n  if (tree_hydrology_reject_tree(hydro, height, cfg)) { return; }",
  },
  {
    name: "runtime import cluster mask",
    path: runtimePath,
    done: "buildTreeRingClusterVisibilityMask",
    needle: "import { treeRingShadowCascadePlanesFromCameras } from \"./tree_ring_shadow_casters.js\";",
    replacement: "import { treeRingShadowCascadePlanesFromCameras } from \"./tree_ring_shadow_casters.js\";\nimport { buildTreeRingClusterVisibilityMask } from \"./tree_ring_cluster_visibility.js\";",
  },
  {
    name: "runtime dispatch cluster mask",
    path: runtimePath,
    done: "clusterVisibilityWords: clusterMask?.words,",
    needle: "    const shadowCapacity = treeGpuRingShadowGroupCapacity(input.settings, shadowCascadePlanes);\n    const dispatched = input.state.compute.dispatch({",
    replacement: "    const shadowCapacity = treeGpuRingShadowGroupCapacity(input.settings, shadowCascadePlanes);\n    const clusterMask = input.settings.gpu.terrainVisibility.enabled && input.sampler\n      ? buildTreeRingClusterVisibilityMask({\n        centerX: center.x,\n        centerZ: center.z,\n        cameraY: camera?.position.y ?? center.y,\n        worldCells: input.worldCells,\n        settings: input.settings,\n        sampler: input.sampler,\n      })\n      : null;\n    const dispatched = input.state.compute.dispatch({",
  },
  {
    name: "runtime dispatch cluster args",
    path: runtimePath,
    done: "clusterGrid: clusterMask?.clusterGrid,",
    needle: "      shadowCascadePlanes: shadowCapacity > 0 ? shadowCascadePlanes : undefined,\n    });",
    replacement: "      shadowCascadePlanes: shadowCapacity > 0 ? shadowCascadePlanes : undefined,\n      clusterVisibilityWords: clusterMask?.words,\n      clusterDimCells: clusterMask?.clusterDimCells,\n      clusterGrid: clusterMask?.clusterGrid,\n    });",
  },
  {
    name: "compute test storage count",
    path: testPath,
    done: "expect(TREE_GPU_RING_STORAGE_BINDINGS).toBe(8);",
    needle: "  treeGpuRingSlotCount,\n} from \"./tree_ring_compute.js\";",
    replacement: "  treeGpuRingSlotCount,\n  TREE_GPU_RING_STORAGE_BINDINGS,\n} from \"./tree_ring_compute.js\";",
  },
  {
    name: "compute test cluster params",
    path: testPath,
    done: "expect(u32[layout.terrainVisibilityUOffset + 2]).toBe(4);",
    needle: "      shadowCascadePlanes: shadowPlanes,\n    });",
    replacement: "      shadowCascadePlanes: shadowPlanes,\n      clusterDimCells: 4,\n      clusterGrid: 8,\n    });",
  },
  {
    name: "compute test cluster asserts",
    path: testPath,
    done: "expect(u32[layout.terrainVisibilityUOffset + 3]).toBe(8);",
    needle: "    expect(u32[layout.terrainVisibilityUOffset]).toBe(9);",
    replacement: "    expect(u32[layout.terrainVisibilityUOffset]).toBe(9);\n    expect(u32[layout.terrainVisibilityUOffset + 2]).toBe(4);\n    expect(u32[layout.terrainVisibilityUOffset + 3]).toBe(8);",
  },
  {
    name: "compute test storage assertion",
    path: testPath,
    done: "expect(TREE_GPU_RING_STORAGE_BINDINGS).toBe(8);",
    needle: "    expect(layout.speciesWeightsOffset).toBe(28);",
    replacement: "    expect(layout.speciesWeightsOffset).toBe(28);\n    expect(TREE_GPU_RING_STORAGE_BINDINGS).toBe(8);",
  },
];

function applyEdit(edit) {
  const source = readFileSync(edit.path, "utf8");
  if (source.includes(edit.done)) return { name: edit.name, status: "already-applied" };
  if (!source.includes(edit.needle)) return { name: edit.name, status: "missing-anchor" };
  writeFileSync(edit.path, source.replace(edit.needle, edit.replacement));
  return { name: edit.name, status: "applied" };
}

const results = edits.map(applyEdit);
console.log(JSON.stringify(results, null, 2));

if (results.some((result) => result.status === "missing-anchor")) {
  process.exitCode = 1;
}
