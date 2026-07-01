import { DIG_EDIT_BYTES, FIELD_PARAM_WORDS, packDigEdits, packFieldParams } from "./gpu_mesh_buffers.js";
import type { ResolvedDigEdit } from "./terrain_field_core.js";
import { treeRingSpeciesGroupIndex, treeRingSpeciesLayout } from "./tree_ring_species_layout.js";
import { composeTreeRingShader } from "./wgsl_modules.js";
import { TREE_LODS, TREE_SPECIES, type TreeLod, type TreeSettings, type TreeSpeciesId } from "../trees/tree_config.js";
import { treeMaterialDensityVector, treeSpeciesMaterialVector } from "../trees/tree_material_bias.js";
import { treeRingAcceptParams, treeRingLodParams } from "../trees/tree_ring_math.js";
import {
  TREE_RING_SHADOW_CASCADE_COUNT,
  TREE_RING_SHADOW_PLANE_COUNT,
  TREE_RING_SHADOW_PLANE_WORDS,
} from "../trees/tree_ring_shadow_casters.js";

const TREE_GPU_RING_LAYOUT = treeRingSpeciesLayout(TREE_SPECIES.length, TREE_RING_SHADOW_CASCADE_COUNT);

export const TREE_GPU_RING_LOD_COUNT = TREE_LODS.length;
export const TREE_GPU_RING_GROUP_COUNT = TREE_GPU_RING_LAYOUT.groupCount;
export const TREE_GPU_RING_SHADOW_GROUP_COUNT = TREE_GPU_RING_LAYOUT.shadowGroupCount;
const TREE_GPU_RING_VISIBLE_PLANE_FLOATS = 6 * 4;
const TREE_GPU_RING_SHADOW_PLANE_FLOATS = TREE_RING_SHADOW_CASCADE_COUNT * TREE_RING_SHADOW_PLANE_COUNT * TREE_RING_SHADOW_PLANE_WORDS;
const PARAM_BYTES = TREE_GPU_RING_LAYOUT.paramBytes;
const COUNTER_BYTES = TREE_GPU_RING_GROUP_COUNT * Uint32Array.BYTES_PER_ELEMENT;
const SHADOW_COUNTER_BYTES = TREE_GPU_RING_SHADOW_GROUP_COUNT * Uint32Array.BYTES_PER_ELEMENT;
const READBACK_BYTES = COUNTER_BYTES + SHADOW_COUNTER_BYTES;
const READBACK_SLOTS = 2;
const READBACK_INTERVAL_FRAMES = 90;
const SHADOW_MAX_LOD_NONE = -1;

export const TREE_GPU_RING_CELL = 3.4;
export const TREE_GPU_RING_STORAGE_BINDINGS = 7;

export type TreeGpuRingCounts = Record<TreeLod, number>;
export type TreeGpuRingIndexCounts = Record<TreeSpeciesId, Record<TreeLod, number>>;

export interface TreeGpuRingOutputBuffers {
  cell: GPUBuffer;
  indirectArgs: GPUBuffer;
  shadowCell?: GPUBuffer;
  shadowIndirectArgs?: GPUBuffer;
}

export interface TreeHydrologyData {
  res: number;
  worldCells: number;
  data: Float32Array;
}

let defaultTreeHydrologyData: TreeHydrologyData | null = null;

export function setTreeGpuRingHydrologyData(data: TreeHydrologyData | null): void {
  defaultTreeHydrologyData = data;
}

export interface TreeGpuRingStats {
  status: "initializing" | "idle" | "running" | "ready" | "failed" | "disabled";
  reason?: string;
  candidateCount: number;
  acceptedCandidates: number;
  counts: TreeGpuRingCounts;
  groupCounts: number[];
  shadowGroupCounts: number[];
  overflowed: boolean;
  shadowOverflowed: boolean;
  submitMs: number | null;
  readbackMs: number | null;
  skippedDispatches: number;
}

export interface TreeGpuRingDispatchParams {
  centerX: number;
  centerZ: number;
  worldCells: number;
  maxInstancesPerGroup: number;
  maxShadowCastersPerGroup?: number;
  indexCounts: TreeGpuRingIndexCounts;
  frustumPlanes?: ArrayLike<number>;
  shadowCascadePlanes?: ArrayLike<number>;
}

interface ReadbackSlot {
  buffer: GPUBuffer;
  busy: boolean;
  destroyAfterMap: boolean;
  visibleCpu: Uint32Array;
  shadowCpu: Uint32Array;
}

type PipelineName = "clear_counters" | "tree_cull" | "build_indirect_args";

export function emptyTreeGpuRingCounts(): TreeGpuRingCounts {
  return { near: 0, mid: 0, far: 0, impostor: 0 };
}

export function treeGpuRingGroupIndex(species: TreeSpeciesId, lod: TreeLod): number {
  return treeRingSpeciesGroupIndex(TREE_SPECIES.indexOf(species), TREE_LODS.indexOf(lod), TREE_SPECIES.length);
}

export function treeGpuRingShadowMaxLodIndex(settings: TreeSettings): number {
  const maxLod = settings.lod.shadowsMaxLod;
  return maxLod === "none" ? SHADOW_MAX_LOD_NONE : TREE_LODS.indexOf(maxLod);
}

export function treeGpuRingGroupRegion(group: number, maxInstancesPerGroup: number): { start: number; end: number; firstInstance: number } {
  const start = Math.max(0, Math.floor(group)) * Math.max(0, Math.floor(maxInstancesPerGroup));
  return { start, end: start + Math.max(0, Math.floor(maxInstancesPerGroup)), firstInstance: start };
}

export function treeGpuRingGrid(settings: Pick<TreeSettings, "distanceM">): number {
  return Math.max(1, Math.ceil((settings.distanceM * 2) / TREE_GPU_RING_CELL));
}

export function treeGpuRingSlotCount(settings: Pick<TreeSettings, "distanceM">): number {
  const grid = treeGpuRingGrid(settings);
  return grid * grid;
}

export function treeGpuRingGroupCapacity(settings: TreeSettings): number {
  return Math.max(1, Math.floor(settings.gpu.maxVisible / TREE_GPU_RING_GROUP_COUNT));
}

export function treeGpuRingWorkgroupSize(settings: TreeSettings): number {
  return settings.gpu.workgroupSize;
}

export function treeGpuRingCullWorkgroups(settings: TreeSettings): number {
  return Math.ceil(treeGpuRingSlotCount(settings) / treeGpuRingWorkgroupSize(settings));
}

export function treeGpuRingCounterWorkgroups(settings: TreeSettings): number {
  const slots = Math.max(TREE_GPU_RING_GROUP_COUNT * 5, TREE_GPU_RING_SHADOW_GROUP_COUNT * 5);
  return Math.ceil(slots / treeGpuRingWorkgroupSize(settings));
}

export function treeGpuRingBuildIndirectWorkgroups(settings: TreeSettings): number {
  const groups = Math.max(TREE_GPU_RING_GROUP_COUNT, TREE_GPU_RING_SHADOW_GROUP_COUNT);
  return Math.ceil(groups / treeGpuRingWorkgroupSize(settings));
}

export function treeGpuRingRequestsDebugReadback(settings: TreeSettings, frame: number): boolean {
  // `readbackVisibleLists` alone is enough to populate the visible/shadow counts
  // (e.g. for the HUD). CPU-parity validation also needs the readback, so it
  // triggers one regardless of the readback flag. `debugShowGpuCounts` is a
  // pure display toggle and no longer gates the readback.
  return (settings.gpu.readbackVisibleLists || settings.gpu.debugValidateAgainstCpu) &&
    frame % READBACK_INTERVAL_FRAMES === 0;
}

export function resolveTreeGpuRingReadbackCounts(
  rawGroupCounts: ArrayLike<number>,
  maxInstancesPerGroup: number,
): { counts: TreeGpuRingCounts; groupCounts: number[]; overflowed: boolean } {
  const cap = Math.max(0, Math.floor(maxInstancesPerGroup));
  const rawCounts = Array.from({ length: TREE_GPU_RING_GROUP_COUNT }, (_, group) =>
    Math.max(0, Math.floor(rawGroupCounts[group] ?? 0)),
  );
  const groupCounts = rawCounts.map((count) => Math.min(count, cap));
  return { counts: aggregateLodCounts(groupCounts), groupCounts, overflowed: rawCounts.some((count) => count > cap) };
}

export function resolveTreeGpuRingShadowReadbackCounts(
  rawGroupCounts: ArrayLike<number>,
  maxCastersPerGroup: number,
): { groupCounts: number[]; overflowed: boolean } {
  const cap = Math.max(0, Math.floor(maxCastersPerGroup));
  const rawCounts = Array.from({ length: TREE_GPU_RING_SHADOW_GROUP_COUNT }, (_, group) =>
    Math.max(0, Math.floor(rawGroupCounts[group] ?? 0)),
  );
  return {
    groupCounts: rawCounts.map((count) => Math.min(count, cap)),
    overflowed: rawCounts.some((count) => count > cap),
  };
}

export function treeGpuRingKey(settings: TreeSettings, worldCells: number): string {
  const lod = treeRingLodParams(settings);
  const accept = treeRingAcceptParams(settings);
  return [
    worldCells, settings.seed, settings.distanceM, settings.gpu.maxVisible,
    lod.near, lod.mid, lod.far, lod.radius, lod.band,
    settings.lod.shadowsMaxLod,
    accept.minHeightM, accept.maxHeightM, accept.slopeMinY, accept.minGroundWeight,
    accept.parentCellM, accept.clumpStrength, accept.clumpThreshold,
    ...accept.materialDensity,
    ...TREE_SPECIES.flatMap((species) => treeSpeciesMaterialVector(settings, species)),
    ...TREE_SPECIES.map((species) => speciesWeight(settings, species)),
    treeGpuRingWorkgroupSize(settings),
  ].join("|");
}

export function treeGpuRingComputeUnsupportedReason(device: GPUDevice): string | null {
  const maxStorageBuffers = device.limits.maxStorageBuffersPerShaderStage;
  if (maxStorageBuffers >= TREE_GPU_RING_STORAGE_BINDINGS) return null;
  return `tree ring compute requires ${TREE_GPU_RING_STORAGE_BINDINGS} storage buffers per shader stage; device limit is ${maxStorageBuffers}`;
}

export function packTreeGpuRingParams(settings: TreeSettings, params: TreeGpuRingDispatchParams, scratch: ArrayBuffer = new ArrayBuffer(PARAM_BYTES)): ArrayBuffer {
  const f32 = new Float32Array(scratch);
  const u32 = new Uint32Array(scratch);
  const lod = treeRingLodParams(settings);
  const accept = treeRingAcceptParams(settings);
  f32.fill(0);
  u32.fill(0);
  f32[0] = params.centerX;
  f32[1] = params.centerZ;
  f32[2] = Math.min(settings.distanceM, lod.radius);
  f32[3] = params.worldCells;
  f32[4] = lod.near;
  f32[5] = lod.mid;
  f32[6] = lod.far;
  f32[7] = lod.band;
  f32[8] = TREE_GPU_RING_CELL;
  f32[9] = accept.minHeightM;
  f32[10] = accept.maxHeightM;
  f32[11] = accept.slopeMinY;
  f32[12] = accept.minGroundWeight;
  f32[13] = accept.lowlandHeightM;
  f32[14] = accept.highlandHeightM;
  f32[15] = accept.heightFadeM;
  f32[16] = accept.slopeFadeStartY;
  f32[17] = accept.slopeFadeEndY;
  f32[18] = accept.materialWeightPower;
  f32[19] = accept.baseDensity;
  f32[20] = accept.parentCellM;
  f32[21] = accept.clumpStrength;
  f32[22] = accept.clumpThreshold;
  f32[23] = accept.waterClearanceM;
  f32[24] = accept.rockReject;
  f32[25] = accept.snowReject;
  f32[26] = treeGpuRingShadowMaxLodIndex(settings);
  TREE_SPECIES.forEach((species, index) => {
    f32[TREE_GPU_RING_LAYOUT.speciesWeightsOffset + index] = speciesWeight(settings, species);
  });
  for (const species of TREE_SPECIES) {
    for (const treeLod of TREE_LODS) {
      u32[TREE_GPU_RING_LAYOUT.indexCountsOffset + treeGpuRingGroupIndex(species, treeLod)] = Math.max(0, Math.floor(params.indexCounts[species][treeLod])) >>> 0;
    }
  }
  u32[TREE_GPU_RING_LAYOUT.settingsOffset] = Math.max(0, Math.floor(params.maxInstancesPerGroup)) >>> 0;
  u32[TREE_GPU_RING_LAYOUT.settingsOffset + 1] = treeGpuRingGrid(settings) >>> 0;
  u32[TREE_GPU_RING_LAYOUT.settingsOffset + 2] = settings.seed >>> 0;
  u32[TREE_GPU_RING_LAYOUT.settingsOffset + 3] = Math.max(0, Math.floor(params.maxShadowCastersPerGroup ?? 0)) >>> 0;
  const density = treeMaterialDensityVector(settings);
  for (let i = 0; i < 4; i++) {
    f32[TREE_GPU_RING_LAYOUT.materialDensityOffset + i] = density[i] ?? 1;
  }
  TREE_SPECIES.forEach((species, speciesIndex) => {
    const material = treeSpeciesMaterialVector(settings, species);
    const offset = TREE_GPU_RING_LAYOUT.speciesMaterialOffset + speciesIndex * 4;
    for (let i = 0; i < 4; i++) f32[offset + i] = material[i] ?? 1;
  });
  if (params.frustumPlanes) {
    for (let i = 0; i < Math.min(TREE_GPU_RING_VISIBLE_PLANE_FLOATS, params.frustumPlanes.length); i++) {
      f32[TREE_GPU_RING_LAYOUT.visiblePlanesOffset + i] = params.frustumPlanes[i] ?? 0;
    }
  }
  if (params.shadowCascadePlanes) {
    for (let i = 0; i < Math.min(TREE_GPU_RING_SHADOW_PLANE_FLOATS, params.shadowCascadePlanes.length); i++) {
      f32[TREE_GPU_RING_LAYOUT.shadowPlanesOffset + i] = params.shadowCascadePlanes[i] ?? 0;
    }
  }
  return scratch;
}

export class TreeGpuRingCompute {
  private readonly paramBuffer: GPUBuffer;
  private readonly counterBuffer: GPUBuffer;
  private readonly shadowCounterBuffer: GPUBuffer;
  private readonly fallbackShadowCellBuffer: GPUBuffer | null;
  private readonly fallbackShadowIndirectBuffer: GPUBuffer | null;
  private readonly shadowOutputsReady: boolean;
  private readonly counterReadbacks: ReadbackSlot[];
  private readonly fieldParams: GPUBuffer;
  private digEdits: GPUBuffer;
  private readonly bindGroup: GPUBindGroup;
  private readonly hydroTexture: GPUTexture;
  private readonly paramScratch = new ArrayBuffer(PARAM_BYTES);
  private readonly pipelines: Record<PipelineName, GPUComputePipeline>;
  private counts: TreeGpuRingCounts = emptyTreeGpuRingCounts();
  private groupCounts = new Array<number>(TREE_GPU_RING_GROUP_COUNT).fill(0);
  private shadowGroupCounts = new Array<number>(TREE_GPU_RING_SHADOW_GROUP_COUNT).fill(0);
  private overflowed = false;
  private shadowOverflowed = false;
  private runningReadbacks = 0;
  private failedReason: string | null = null;
  private submitMs: number | null = null;
  private readbackMs: number | null = null;
  private skippedDispatches = 0;
  private generation = 0;
  private frame = 0;

  private constructor(
    private readonly device: GPUDevice,
    layout: GPUBindGroupLayout,
    pipelines: Record<PipelineName, GPUComputePipeline>,
    edits: readonly ResolvedDigEdit[],
    outputBuffers: TreeGpuRingOutputBuffers,
    private readonly settings: TreeSettings,
    hydroData: TreeHydrologyData | null,
  ) {
    this.pipelines = pipelines;
    this.shadowOutputsReady = !!outputBuffers.shadowCell && !!outputBuffers.shadowIndirectArgs;
    this.paramBuffer = device.createBuffer({ label: "tree ring params", size: PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.counterBuffer = device.createBuffer({ label: "tree ring counters", size: COUNTER_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.shadowCounterBuffer = device.createBuffer({ label: "tree ring shadow counters", size: SHADOW_COUNTER_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.fallbackShadowCellBuffer = outputBuffers.shadowCell ? null : device.createBuffer({ label: "tree ring fallback shadow cells", size: 16, usage: GPUBufferUsage.STORAGE });
    this.fallbackShadowIndirectBuffer = outputBuffers.shadowIndirectArgs ? null : device.createBuffer({ label: "tree ring fallback shadow indirect", size: TREE_GPU_RING_SHADOW_GROUP_COUNT * 5 * Uint32Array.BYTES_PER_ELEMENT, usage: GPUBufferUsage.STORAGE });
    this.fieldParams = device.createBuffer({ label: "tree ring field params", size: FIELD_PARAM_WORDS * Uint32Array.BYTES_PER_ELEMENT, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.digEdits = device.createBuffer({ label: "tree ring dig edits", size: Math.max(1, edits.length) * DIG_EDIT_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.digEdits, 0, packDigEdits(edits));
    const packedFieldParams = packFieldParams(edits.length);
    device.queue.writeBuffer(this.fieldParams, 0, packedFieldParams.buffer as ArrayBuffer, packedFieldParams.byteOffset, packedFieldParams.byteLength);
    this.counterReadbacks = Array.from({ length: READBACK_SLOTS }, (_, index) => ({
      buffer: device.createBuffer({ label: `tree ring counter readback ${index}`, size: READBACK_BYTES, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
      busy: false,
      destroyAfterMap: false,
      visibleCpu: new Uint32Array(TREE_GPU_RING_GROUP_COUNT),
      shadowCpu: new Uint32Array(TREE_GPU_RING_SHADOW_GROUP_COUNT),
    }));
    this.hydroTexture = this.createHydrologyTexture(hydroData);
    const hydroSampler = device.createSampler({ label: "tree ring hydro sampler", magFilter: "nearest", minFilter: "nearest" });
    this.bindGroup = device.createBindGroup({
      label: "tree ring bind group",
      layout,
      entries: [
        { binding: 0, resource: { buffer: this.paramBuffer } },
        { binding: 1, resource: { buffer: this.counterBuffer } },
        { binding: 2, resource: { buffer: outputBuffers.indirectArgs } },
        { binding: 3, resource: { buffer: outputBuffers.cell } },
        { binding: 4, resource: { buffer: this.shadowCounterBuffer } },
        { binding: 5, resource: { buffer: outputBuffers.shadowIndirectArgs ?? this.fallbackShadowIndirectBuffer! } },
        { binding: 6, resource: { buffer: outputBuffers.shadowCell ?? this.fallbackShadowCellBuffer! } },
        { binding: 7, resource: { buffer: this.digEdits } },
        { binding: 8, resource: { buffer: this.fieldParams } },
        { binding: 9, resource: this.hydroTexture.createView() },
        { binding: 10, resource: hydroSampler },
      ],
    });
  }

  static async create(device: GPUDevice, edits: readonly ResolvedDigEdit[], outputBuffers: TreeGpuRingOutputBuffers, settings: TreeSettings, hydroData: TreeHydrologyData | null = null): Promise<TreeGpuRingCompute> {
    const module = device.createShaderModule({ label: "tree ring compute shader", code: composeTreeRingShader(treeGpuRingWorkgroupSize(settings)) });
    const storage = (binding: number, type: GPUBufferBindingType = "storage"): GPUBindGroupLayoutEntry => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type } });
    const layout = device.createBindGroupLayout({
      label: "tree ring compute layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        storage(1), storage(2), storage(3), storage(4), storage(5), storage(6), storage(7, "read-only-storage"),
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 9, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
        { binding: 10, visibility: GPUShaderStage.COMPUTE, sampler: {} },
      ],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const makePipeline = (entryPoint: PipelineName) => device.createComputePipelineAsync({ label: `tree ring ${entryPoint}`, layout: pipelineLayout, compute: { module, entryPoint } });
    const [clearCounters, cull, buildIndirectArgs] = await Promise.all([makePipeline("clear_counters"), makePipeline("tree_cull"), makePipeline("build_indirect_args")]);
    return new TreeGpuRingCompute(device, layout, { clear_counters: clearCounters, tree_cull: cull, build_indirect_args: buildIndirectArgs }, edits, outputBuffers, { ...settings }, hydroData ?? defaultTreeHydrologyData);
  }

  dispatch(params: TreeGpuRingDispatchParams): boolean {
    if (this.failedReason) return false;
    const frame = this.frame++;
    const requestReadback = treeGpuRingRequestsDebugReadback(this.settings, frame);
    const readbackSlot = requestReadback ? this.counterReadbacks.find((candidate) => !candidate.busy) ?? null : null;
    if (requestReadback && !readbackSlot) this.skippedDispatches++;
    const effectiveParams = this.shadowOutputsReady ? params : {
      ...params,
      maxShadowCastersPerGroup: 0,
      shadowCascadePlanes: undefined,
    };
    packTreeGpuRingParams(this.settings, effectiveParams, this.paramScratch);
    this.device.queue.writeBuffer(this.paramBuffer, 0, this.paramScratch);
    const encoder = this.device.createCommandEncoder({ label: "tree ring compute encoder" });
    this.dispatchPipeline(encoder, this.pipelines.clear_counters, treeGpuRingCounterWorkgroups(this.settings));
    this.dispatchPipeline(encoder, this.pipelines.tree_cull, treeGpuRingCullWorkgroups(this.settings));
    this.dispatchPipeline(encoder, this.pipelines.build_indirect_args, treeGpuRingBuildIndirectWorkgroups(this.settings));
    if (readbackSlot) {
      encoder.copyBufferToBuffer(this.counterBuffer, 0, readbackSlot.buffer, 0, COUNTER_BYTES);
      encoder.copyBufferToBuffer(this.shadowCounterBuffer, 0, readbackSlot.buffer, COUNTER_BYTES, SHADOW_COUNTER_BYTES);
    }
    const submittedGeneration = this.generation;
    const submitStart = performance.now();
    if (readbackSlot) { readbackSlot.busy = true; readbackSlot.destroyAfterMap = false; this.runningReadbacks++; }
    this.device.queue.submit([encoder.finish()]);
    this.submitMs = performance.now() - submitStart;
    if (readbackSlot) {
      const slot = readbackSlot;
      const readbackStart = performance.now();
      void slot.buffer.mapAsync(GPUMapMode.READ).then(() => {
        if (submittedGeneration !== this.generation) {
          slot.busy = false; slot.destroyAfterMap = false; this.runningReadbacks = Math.max(0, this.runningReadbacks - 1); slot.buffer.unmap(); slot.buffer.destroy(); return;
        }
        const mapped = slot.buffer.getMappedRange(0, READBACK_BYTES);
        slot.visibleCpu.set(new Uint32Array(mapped, 0, TREE_GPU_RING_GROUP_COUNT));
        slot.shadowCpu.set(new Uint32Array(mapped, COUNTER_BYTES, TREE_GPU_RING_SHADOW_GROUP_COUNT));
        slot.buffer.unmap();
        slot.busy = false;
        this.runningReadbacks = Math.max(0, this.runningReadbacks - 1);
        this.readbackMs = performance.now() - readbackStart;
        const resolved = resolveTreeGpuRingReadbackCounts(slot.visibleCpu, effectiveParams.maxInstancesPerGroup);
        const resolvedShadow = resolveTreeGpuRingShadowReadbackCounts(slot.shadowCpu, effectiveParams.maxShadowCastersPerGroup ?? 0);
        this.groupCounts = resolved.groupCounts;
        this.shadowGroupCounts = resolvedShadow.groupCounts;
        this.counts = resolved.counts;
        this.overflowed = resolved.overflowed;
        this.shadowOverflowed = resolvedShadow.overflowed;
        if (slot.destroyAfterMap) { slot.destroyAfterMap = false; slot.buffer.destroy(); }
      }).catch((error) => {
        if (submittedGeneration !== this.generation) {
          slot.busy = false; slot.destroyAfterMap = false; this.runningReadbacks = Math.max(0, this.runningReadbacks - 1); slot.buffer.destroy(); return;
        }
        slot.busy = false;
        this.runningReadbacks = Math.max(0, this.runningReadbacks - 1);
        if (slot.destroyAfterMap) { slot.destroyAfterMap = false; slot.buffer.destroy(); return; }
        this.failedReason = error instanceof Error ? error.message : String(error);
      });
    }
    return true;
  }

  stats(enabled: boolean): TreeGpuRingStats {
    const acceptedCandidates = this.counts.near + this.counts.mid + this.counts.far + this.counts.impostor;
    return {
      status: !enabled ? "disabled" : this.failedReason ? "failed" : this.runningReadbacks > 0 ? "running" : "ready",
      reason: this.failedReason ?? undefined,
      candidateCount: treeGpuRingSlotCount(this.settings),
      acceptedCandidates,
      counts: { ...this.counts },
      groupCounts: [...this.groupCounts],
      shadowGroupCounts: [...this.shadowGroupCounts],
      overflowed: this.overflowed,
      shadowOverflowed: this.shadowOverflowed,
      submitMs: this.submitMs,
      readbackMs: this.readbackMs,
      skippedDispatches: this.skippedDispatches,
    };
  }

  destroy(): void {
    this.generation++;
    this.runningReadbacks = 0;
    this.paramBuffer.destroy();
    this.counterBuffer.destroy();
    this.shadowCounterBuffer.destroy();
    this.fallbackShadowCellBuffer?.destroy();
    this.fallbackShadowIndirectBuffer?.destroy();
    this.digEdits.destroy();
    this.fieldParams.destroy();
    this.hydroTexture.destroy();
    for (const slot of this.counterReadbacks) {
      if (slot.busy) slot.destroyAfterMap = true;
      else slot.buffer.destroy();
    }
  }

  private dispatchPipeline(encoder: GPUCommandEncoder, pipeline: GPUComputePipeline, workgroups: number): void {
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.max(1, workgroups));
    pass.end();
  }

  private createHydrologyTexture(hydroData: TreeHydrologyData | null): GPUTexture {
    if (hydroData && hydroData.data.length > 0) {
      const texture = this.device.createTexture({ label: "tree ring hydro texture", size: { width: hydroData.res, height: hydroData.res }, format: "rgba32float", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      const bytes = new Uint8Array(hydroData.data.byteLength);
      bytes.set(new Uint8Array(hydroData.data.buffer, hydroData.data.byteOffset, hydroData.data.byteLength));
      this.device.queue.writeTexture(
        { texture },
        bytes, { bytesPerRow: hydroData.res * 16 }, { width: hydroData.res, height: hydroData.res });
      return texture;
    }
    return this.device.createTexture({ label: "tree ring fallback hydro texture", size: { width: 1, height: 1 }, format: "rgba32float", usage: GPUTextureUsage.TEXTURE_BINDING });
  }
}

function speciesWeight(settings: TreeSettings, species: TreeSpeciesId): number {
  const config = settings.species[species];
  return config.enabled ? Math.max(0, config.weight) : 0;
}

function aggregateLodCounts(groupCounts: readonly number[]): TreeGpuRingCounts {
  const counts = emptyTreeGpuRingCounts();
  for (const species of TREE_SPECIES) {
    for (const treeLod of TREE_LODS) counts[treeLod] += groupCounts[treeGpuRingGroupIndex(species, treeLod)] ?? 0;
  }
  return counts;
}
