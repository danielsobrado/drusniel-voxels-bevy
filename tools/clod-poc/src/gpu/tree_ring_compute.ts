import { DIG_EDIT_BYTES, packDigEdits, packFieldParams } from "./gpu_mesh_buffers.js";
import type { ResolvedDigEdit } from "./terrain_field_core.js";
import { composeTreeRingShader } from "./wgsl_modules.js";
import { TREE_LODS, TREE_SPECIES, type TreeLod, type TreeSettings, type TreeSpeciesId } from "../trees/tree_config.js";
import { treeRingAcceptParams, treeRingLodParams } from "../trees/tree_ring_math.js";

export const TREE_GPU_RING_LOD_COUNT = TREE_LODS.length;
export const TREE_GPU_RING_GROUP_COUNT = TREE_SPECIES.length * TREE_GPU_RING_LOD_COUNT;
const PARAM_BYTES = 16 * 18;
const COUNTER_BYTES = TREE_GPU_RING_GROUP_COUNT * Uint32Array.BYTES_PER_ELEMENT;
const READBACK_SLOTS = 2;
const READBACK_INTERVAL_FRAMES = 90;

export const TREE_GPU_RING_CELL = 3.4;
export const TREE_GPU_RING_STORAGE_BINDINGS = 6;

export type TreeGpuRingCounts = Record<TreeLod, number>;
export type TreeGpuRingIndexCounts = Record<TreeSpeciesId, Record<TreeLod, number>>;

export interface TreeGpuRingOutputBuffers {
  cell: GPUBuffer;
  indirectArgs: GPUBuffer;
}

export interface TreeGpuRingStats {
  status: "initializing" | "idle" | "running" | "ready" | "failed" | "disabled";
  reason?: string;
  candidateCount: number;
  acceptedCandidates: number;
  counts: TreeGpuRingCounts;
  groupCounts: number[];
  dispatchMs: number | null;
  readbackMs: number | null;
  skippedDispatches: number;
}

export interface TreeGpuRingDispatchParams {
  centerX: number;
  centerZ: number;
  worldCells: number;
  maxInstancesPerGroup: number;
  indexCounts: TreeGpuRingIndexCounts;
  frustumPlanes?: ArrayLike<number>;
}

interface ReadbackSlot {
  buffer: GPUBuffer;
  busy: boolean;
  cpu: Uint32Array;
}

type PipelineName = "clear_counters" | "tree_cull" | "build_indirect_args";

export function emptyTreeGpuRingCounts(): TreeGpuRingCounts {
  return { near: 0, mid: 0, far: 0, impostor: 0 };
}

export function treeGpuRingGroupIndex(species: TreeSpeciesId, lod: TreeLod): number {
  return TREE_SPECIES.indexOf(species) * TREE_GPU_RING_LOD_COUNT + TREE_LODS.indexOf(lod);
}

export function treeGpuRingGroupRegion(group: number, maxInstancesPerGroup: number): { start: number; end: number; firstInstance: number } {
  const start = Math.max(0, Math.floor(group)) * Math.max(0, Math.floor(maxInstancesPerGroup));
  return {
    start,
    end: start + Math.max(0, Math.floor(maxInstancesPerGroup)),
    firstInstance: start,
  };
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

export function treeGpuRingRequestsDebugReadback(settings: TreeSettings, frame: number): boolean {
  return settings.gpu.readbackVisibleLists &&
    settings.gpu.debugShowGpuCounts &&
    frame % READBACK_INTERVAL_FRAMES === 0;
}

export function treeGpuRingKey(settings: TreeSettings, worldCells: number): string {
  const lod = treeRingLodParams(settings);
  const accept = treeRingAcceptParams(settings);
  return [
    worldCells,
    settings.seed,
    settings.distanceM,
    settings.gpu.maxVisible,
    lod.near,
    lod.mid,
    lod.far,
    lod.radius,
    lod.band,
    accept.minHeightM,
    accept.maxHeightM,
    accept.slopeMinY,
    accept.minGroundWeight,
    accept.parentCellM,
    accept.clumpStrength,
    accept.clumpThreshold,
    speciesWeight(settings, "oak"),
    speciesWeight(settings, "pine"),
    speciesWeight(settings, "dead"),
    treeGpuRingWorkgroupSize(settings),
  ].join("|");
}

export function treeGpuRingComputeUnsupportedReason(device: GPUDevice): string | null {
  const maxStorageBuffers = device.limits.maxStorageBuffersPerShaderStage;
  if (maxStorageBuffers >= TREE_GPU_RING_STORAGE_BINDINGS) return null;
  return `tree ring compute requires ${TREE_GPU_RING_STORAGE_BINDINGS} storage buffers per shader stage; device limit is ${maxStorageBuffers}`;
}

export function packTreeGpuRingParams(
  settings: TreeSettings,
  params: TreeGpuRingDispatchParams,
  scratch: ArrayBuffer = new ArrayBuffer(PARAM_BYTES),
): ArrayBuffer {
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
  f32[28] = speciesWeight(settings, "oak");
  f32[29] = speciesWeight(settings, "pine");
  f32[30] = speciesWeight(settings, "dead");
  for (const species of TREE_SPECIES) {
    for (const treeLod of TREE_LODS) {
      u32[32 + treeGpuRingGroupIndex(species, treeLod)] = Math.max(0, Math.floor(params.indexCounts[species][treeLod])) >>> 0;
    }
  }
  u32[44] = Math.max(0, Math.floor(params.maxInstancesPerGroup)) >>> 0;
  u32[45] = treeGpuRingGrid(settings) >>> 0;
  u32[46] = settings.seed >>> 0;
  if (params.frustumPlanes) {
    for (let i = 0; i < Math.min(24, params.frustumPlanes.length); i++) {
      f32[48 + i] = params.frustumPlanes[i] ?? 0;
    }
  }
  return scratch;
}

export class TreeGpuRingCompute {
  private readonly paramBuffer: GPUBuffer;
  private readonly counterBuffer: GPUBuffer;
  private readonly counterReadbacks: ReadbackSlot[];
  private readonly fieldParams: GPUBuffer;
  private digEdits: GPUBuffer;
  private readonly bindGroup: GPUBindGroup;
  private readonly paramScratch = new ArrayBuffer(PARAM_BYTES);
  private readonly pipelines: Record<PipelineName, GPUComputePipeline>;
  private counts: TreeGpuRingCounts = emptyTreeGpuRingCounts();
  private groupCounts = new Array<number>(TREE_GPU_RING_GROUP_COUNT).fill(0);
  private runningReadbacks = 0;
  private failedReason: string | null = null;
  private dispatchMs: number | null = null;
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
  ) {
    this.pipelines = pipelines;
    this.paramBuffer = device.createBuffer({
      label: "tree ring params",
      size: PARAM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.counterBuffer = device.createBuffer({
      label: "tree ring counters",
      size: COUNTER_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this.fieldParams = device.createBuffer({
      label: "tree ring field params",
      size: 4 * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.digEdits = device.createBuffer({
      label: "tree ring dig edits",
      size: Math.max(1, edits.length) * DIG_EDIT_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.digEdits, 0, packDigEdits(edits));
    const packedFieldParams = packFieldParams(edits.length);
    device.queue.writeBuffer(
      this.fieldParams,
      0,
      packedFieldParams.buffer as ArrayBuffer,
      packedFieldParams.byteOffset,
      packedFieldParams.byteLength,
    );
    this.counterReadbacks = Array.from({ length: READBACK_SLOTS }, (_, index) => ({
      buffer: device.createBuffer({
        label: `tree ring counter readback ${index}`,
        size: COUNTER_BYTES,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }),
      busy: false,
      cpu: new Uint32Array(TREE_GPU_RING_GROUP_COUNT),
    }));
    this.bindGroup = device.createBindGroup({
      label: "tree ring bind group",
      layout,
      entries: [
        { binding: 0, resource: { buffer: this.paramBuffer } },
        { binding: 1, resource: { buffer: this.counterBuffer } },
        { binding: 2, resource: { buffer: outputBuffers.indirectArgs } },
        { binding: 3, resource: { buffer: outputBuffers.cell } },
        { binding: 7, resource: { buffer: this.digEdits } },
        { binding: 8, resource: { buffer: this.fieldParams } },
      ],
    });
  }

  static async create(
    device: GPUDevice,
    edits: readonly ResolvedDigEdit[],
    outputBuffers: TreeGpuRingOutputBuffers,
    settings: TreeSettings,
  ): Promise<TreeGpuRingCompute> {
    const module = device.createShaderModule({
      label: "tree ring compute shader",
      code: composeTreeRingShader(treeGpuRingWorkgroupSize(settings)),
    });
    const storage = (binding: number, type: GPUBufferBindingType = "storage"): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type },
    });
    const layout = device.createBindGroupLayout({
      label: "tree ring compute layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        storage(1),
        storage(2),
        storage(3),
        storage(7, "read-only-storage"),
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      ],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const makePipeline = (entryPoint: PipelineName) =>
      device.createComputePipelineAsync({
        label: `tree ring ${entryPoint}`,
        layout: pipelineLayout,
        compute: { module, entryPoint },
      });
    const [clearCounters, cull, buildIndirectArgs] = await Promise.all([
      makePipeline("clear_counters"),
      makePipeline("tree_cull"),
      makePipeline("build_indirect_args"),
    ]);
    return new TreeGpuRingCompute(device, layout, {
      clear_counters: clearCounters,
      tree_cull: cull,
      build_indirect_args: buildIndirectArgs,
    }, edits, outputBuffers, { ...settings });
  }

  dispatch(params: TreeGpuRingDispatchParams): boolean {
    if (this.failedReason) return false;

    const frame = this.frame++;
    const requestReadback = treeGpuRingRequestsDebugReadback(this.settings, frame);
    const readbackSlot = requestReadback
      ? this.counterReadbacks.find((candidate) => !candidate.busy) ?? null
      : null;
    if (requestReadback && !readbackSlot) this.skippedDispatches++;

    packTreeGpuRingParams(this.settings, params, this.paramScratch);
    this.device.queue.writeBuffer(this.paramBuffer, 0, this.paramScratch);

    const encoder = this.device.createCommandEncoder({ label: "tree ring compute encoder" });
    this.dispatchPipeline(encoder, this.pipelines.clear_counters, 1);
    this.dispatchPipeline(
      encoder,
      this.pipelines.tree_cull,
      treeGpuRingCullWorkgroups(this.settings),
    );
    this.dispatchPipeline(encoder, this.pipelines.build_indirect_args, 1);
    if (readbackSlot) {
      encoder.copyBufferToBuffer(this.counterBuffer, 0, readbackSlot.buffer, 0, COUNTER_BYTES);
    }

    const submittedGeneration = this.generation;
    const submitStart = performance.now();
    if (readbackSlot) {
      readbackSlot.busy = true;
      this.runningReadbacks++;
    }
    this.device.queue.submit([encoder.finish()]);
    this.dispatchMs = performance.now() - submitStart;

    if (readbackSlot) {
      const slot = readbackSlot;
      const readbackStart = performance.now();
      void slot.buffer.mapAsync(GPUMapMode.READ).then(() => {
        if (submittedGeneration !== this.generation) {
          slot.buffer.destroy();
          return;
        }
        slot.cpu.set(new Uint32Array(slot.buffer.getMappedRange(0, COUNTER_BYTES)));
        slot.buffer.unmap();
        slot.busy = false;
        this.runningReadbacks = Math.max(0, this.runningReadbacks - 1);
        this.readbackMs = performance.now() - readbackStart;
        const cap = Math.max(0, Math.floor(params.maxInstancesPerGroup));
        this.groupCounts = Array.from(slot.cpu, (count) => Math.min(count, cap));
        this.counts = aggregateLodCounts(this.groupCounts);
      }).catch((error) => {
        if (submittedGeneration !== this.generation) return;
        slot.busy = false;
        this.runningReadbacks = Math.max(0, this.runningReadbacks - 1);
        this.failedReason = error instanceof Error ? error.message : String(error);
      });
    }
    return true;
  }

  stats(enabled: boolean): TreeGpuRingStats {
    const acceptedCandidates = this.counts.near + this.counts.mid + this.counts.far + this.counts.impostor;
    return {
      status: !enabled
        ? "disabled"
        : this.failedReason
          ? "failed"
          : this.runningReadbacks > 0 ? "running" : "ready",
      reason: this.failedReason ?? undefined,
      candidateCount: treeGpuRingSlotCount(this.settings),
      acceptedCandidates,
      counts: { ...this.counts },
      groupCounts: [...this.groupCounts],
      dispatchMs: this.dispatchMs,
      readbackMs: this.readbackMs,
      skippedDispatches: this.skippedDispatches,
    };
  }

  destroy(): void {
    this.generation++;
    this.runningReadbacks = 0;
    this.paramBuffer.destroy();
    this.counterBuffer.destroy();
    this.digEdits.destroy();
    this.fieldParams.destroy();
    for (const slot of this.counterReadbacks) {
      if (!slot.busy) slot.buffer.destroy();
    }
  }

  private dispatchPipeline(encoder: GPUCommandEncoder, pipeline: GPUComputePipeline, workgroups: number): void {
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.max(1, workgroups));
    pass.end();
  }
}

function speciesWeight(settings: TreeSettings, species: TreeSpeciesId): number {
  const config = settings.species[species];
  return config.enabled ? Math.max(0, config.weight) : 0;
}

function aggregateLodCounts(groupCounts: readonly number[]): TreeGpuRingCounts {
  const counts = emptyTreeGpuRingCounts();
  for (const species of TREE_SPECIES) {
    for (const treeLod of TREE_LODS) {
      counts[treeLod] += groupCounts[treeGpuRingGroupIndex(species, treeLod)] ?? 0;
    }
  }
  return counts;
}
