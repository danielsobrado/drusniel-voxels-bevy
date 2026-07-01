import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const computePath = resolve(root, "src/gpu/tree_ring_compute.ts");
const modulesPath = resolve(root, "src/gpu/wgsl_modules.ts");
const runtimePath = resolve(root, "src/trees/tree_system_gpu_ring_runtime.ts");
const testPath = resolve(root, "src/gpu/wgsl_modules.test.ts");

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
    done: "visibleClusterMaskWords?: Uint32Array;",
    needle: "  shadowCascadePlanes?: ArrayLike<number>;\n}",
    replacement: "  shadowCascadePlanes?: ArrayLike<number>;\n  /** Camera-visibility mask for visible-list generation only. Never gate shadow casters with this. */\n  visibleClusterMaskWords?: Uint32Array;\n  visibleClusterDimCells?: number;\n  visibleClusterGrid?: number;\n}",
  },
  {
    name: "pack visible cluster mask metadata",
    path: computePath,
    done: "u32[TREE_GPU_RING_LAYOUT.terrainVisibilityUOffset + 2] = Math.max(1, Math.floor(params.visibleClusterDimCells ?? 0)) >>> 0;",
    needle: "  u32[TREE_GPU_RING_LAYOUT.terrainVisibilityUOffset] = Math.max(1, Math.min(16, Math.floor(settings.gpu.terrainVisibility.sampleCount))) >>> 0;",
    replacement: "  u32[TREE_GPU_RING_LAYOUT.terrainVisibilityUOffset] = Math.max(1, Math.min(16, Math.floor(settings.gpu.terrainVisibility.sampleCount))) >>> 0;\n  u32[TREE_GPU_RING_LAYOUT.terrainVisibilityUOffset + 2] = Math.max(1, Math.floor(params.visibleClusterDimCells ?? 0)) >>> 0;\n  u32[TREE_GPU_RING_LAYOUT.terrainVisibilityUOffset + 3] = Math.max(0, Math.floor(params.visibleClusterGrid ?? 0)) >>> 0;",
  },
  {
    name: "compute visible cluster buffer fields",
    path: computePath,
    done: "private readonly visibleClusterMaskBuffer: GPUBuffer;",
    needle: "  private readonly shadowCounterBuffer: GPUBuffer;",
    replacement: "  private readonly shadowCounterBuffer: GPUBuffer;\n  private readonly visibleClusterMaskBuffer: GPUBuffer;\n  private readonly visibleClusterMaskWordCapacity: number;",
  },
  {
    name: "compute visible cluster buffer create",
    path: computePath,
    done: "label: \"tree ring visible cluster mask\"",
    needle: "    this.shadowOutputsReady = !!outputBuffers.shadowCell && !!outputBuffers.shadowIndirectArgs;\n    this.paramBuffer = device.createBuffer",
    replacement: "    this.shadowOutputsReady = !!outputBuffers.shadowCell && !!outputBuffers.shadowIndirectArgs;\n    this.visibleClusterMaskWordCapacity = treeGpuRingSlotCount(settings);\n    this.visibleClusterMaskBuffer = device.createBuffer({ label: \"tree ring visible cluster mask\", size: Math.max(1, this.visibleClusterMaskWordCapacity) * Uint32Array.BYTES_PER_ELEMENT, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });\n    this.paramBuffer = device.createBuffer",
  },
  {
    name: "compute visible cluster bind entry",
    path: computePath,
    done: "{ binding: 11, resource: { buffer: this.visibleClusterMaskBuffer } }",
    needle: "        { binding: 10, resource: hydroSampler },\n      ],",
    replacement: "        { binding: 10, resource: hydroSampler },\n        { binding: 11, resource: { buffer: this.visibleClusterMaskBuffer } },\n      ],",
  },
  {
    name: "compute visible cluster layout entry",
    path: computePath,
    done: "storage(11, \"read-only-storage\")",
    needle: "        { binding: 10, visibility: GPUShaderStage.COMPUTE, sampler: {} },\n      ],",
    replacement: "        { binding: 10, visibility: GPUShaderStage.COMPUTE, sampler: {} },\n        storage(11, \"read-only-storage\"),\n      ],",
  },
  {
    name: "compute visible cluster upload",
    path: computePath,
    done: "effectiveParams.visibleClusterMaskWords.buffer",
    needle: "    packTreeGpuRingParams(this.settings, effectiveParams, this.paramScratch);\n    new Uint32Array(this.paramScratch)[TREE_GPU_RING_LAYOUT.terrainVisibilityUOffset + 1] = readbackSlot ? 1 : 0;\n    this.device.queue.writeBuffer(this.paramBuffer, 0, this.paramScratch);",
    replacement: "    packTreeGpuRingParams(this.settings, effectiveParams, this.paramScratch);\n    const u32 = new Uint32Array(this.paramScratch);\n    u32[TREE_GPU_RING_LAYOUT.terrainVisibilityUOffset + 1] = readbackSlot ? 1 : 0;\n    if (effectiveParams.visibleClusterMaskWords && effectiveParams.visibleClusterMaskWords.length > 0) {\n      const wordCount = Math.min(effectiveParams.visibleClusterMaskWords.length, this.visibleClusterMaskWordCapacity);\n      this.device.queue.writeBuffer(\n        this.visibleClusterMaskBuffer,\n        0,\n        effectiveParams.visibleClusterMaskWords.buffer,\n        effectiveParams.visibleClusterMaskWords.byteOffset,\n        wordCount * Uint32Array.BYTES_PER_ELEMENT,\n      );\n    } else {\n      u32[TREE_GPU_RING_LAYOUT.terrainVisibilityUOffset + 3] = 0;\n    }\n    this.device.queue.writeBuffer(this.paramBuffer, 0, this.paramScratch);",
  },
  {
    name: "compute visible cluster destroy",
    path: computePath,
    done: "this.visibleClusterMaskBuffer.destroy();",
    needle: "    this.shadowCounterBuffer.destroy();",
    replacement: "    this.shadowCounterBuffer.destroy();\n    this.visibleClusterMaskBuffer.destroy();",
  },
  {
    name: "wgsl visible cluster binding injection",
    path: modulesPath,
    done: "var<storage, read> tree_visible_cluster_mask: array<u32>;",
    needle: "fn tree_terrain_visibility_enabled() -> bool {",
    replacement: "@group(0) @binding(11) var<storage, read> tree_visible_cluster_mask: array<u32>;\n\nfn tree_terrain_visibility_enabled() -> bool {",
  },
  {
    name: "wgsl visible cluster helper injection",
    path: modulesPath,
    done: "fn tree_slot_visible_cluster_visible(slot: u32) -> bool",
    needle: "fn tree_terrain_visibility_enabled() -> bool {\n  return params.terrain_visibility.x > 0.5;\n}",
    replacement: "fn tree_terrain_visibility_enabled() -> bool {\n  return params.terrain_visibility.x > 0.5;\n}\n\nfn tree_slot_visible_cluster_visible(slot: u32) -> bool {\n  let cluster_grid = params.terrain_visibility_u.w;\n  if (cluster_grid == 0u) { return true; }\n  let cluster_dim = max(1u, params.terrain_visibility_u.z);\n  let grid = max(1u, params.settings_u.y);\n  let slot_x = slot % grid;\n  let slot_z = slot / grid;\n  let cluster_x = min(cluster_grid - 1u, slot_x / cluster_dim);\n  let cluster_z = min(cluster_grid - 1u, slot_z / cluster_dim);\n  return tree_visible_cluster_mask[cluster_z * cluster_grid + cluster_x] != 0u;\n}",
  },
  {
    name: "wgsl visible-only cluster gate",
    path: modulesPath,
    done: "if (terrain_hidden || !tree_slot_visible_cluster_visible(slot)) { return; }",
    needle: "  if (terrain_hidden) { return; }",
    replacement: "  if (terrain_hidden || !tree_slot_visible_cluster_visible(slot)) { return; }",
  },
  {
    name: "runtime import cluster mask",
    path: runtimePath,
    done: "buildTreeRingClusterVisibilityMask",
    needle: "import { treeRingShadowCascadePlanesFromCameras } from \"./tree_ring_shadow_casters.js\";",
    replacement: "import { treeRingShadowCascadePlanesFromCameras } from \"./tree_ring_shadow_casters.js\";\nimport { buildTreeRingClusterVisibilityMask } from \"./tree_ring_cluster_visibility.js\";",
  },
  {
    name: "runtime build visible cluster mask",
    path: runtimePath,
    done: "visibleClusterMaskWords: visibleClusterMask?.words,",
    needle: "    const shadowCapacity = treeGpuRingShadowGroupCapacity(input.settings, shadowCascadePlanes);\n    const dispatched = input.state.compute.dispatch({",
    replacement: "    const shadowCapacity = treeGpuRingShadowGroupCapacity(input.settings, shadowCascadePlanes);\n    const visibleClusterMask = input.settings.gpu.terrainVisibility.enabled && input.sampler\n      ? buildTreeRingClusterVisibilityMask({\n        centerX: center.x,\n        centerZ: center.z,\n        cameraY: camera?.position.y ?? center.y,\n        worldCells: input.worldCells,\n        settings: input.settings,\n        sampler: input.sampler,\n      })\n      : null;\n    const dispatched = input.state.compute.dispatch({",
  },
  {
    name: "runtime pass visible cluster mask",
    path: runtimePath,
    done: "visibleClusterGrid: visibleClusterMask?.clusterGrid,",
    needle: "      shadowCascadePlanes: shadowCapacity > 0 ? shadowCascadePlanes : undefined,\n    });",
    replacement: "      shadowCascadePlanes: shadowCapacity > 0 ? shadowCascadePlanes : undefined,\n      visibleClusterMaskWords: visibleClusterMask?.words,\n      visibleClusterDimCells: visibleClusterMask?.clusterDimCells,\n      visibleClusterGrid: visibleClusterMask?.clusterGrid,\n    });",
  },
  {
    name: "wgsl test visible-only cluster gate",
    path: testPath,
    done: "tree_slot_visible_cluster_visible(slot)",
    needle: "    expect(source).toContain(\"terrain_ridge_filter(wpos, height, dist)\");",
    replacement: "    expect(source).toContain(\"terrain_ridge_filter(wpos, height, dist)\");\n    expect(source).toContain(\"tree_slot_visible_cluster_visible(slot)\");",
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
