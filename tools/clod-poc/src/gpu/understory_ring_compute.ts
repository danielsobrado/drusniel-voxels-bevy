import { DIG_EDIT_BYTES, FIELD_PARAM_WORDS, packDigEdits, packFieldParams } from "./gpu_mesh_buffers.js";
import { getTerrainFieldCoreConfig, resolveDigEdits, type ResolvedDigEdit } from "./terrain_field_core.js";
import { composeUnderstoryRingShader } from "./wgsl_modules.js";
import type { UnderstorySettings } from "../understory/understory_config.js";
import {
  UNDERSTORY_RING_CLASS_STRIDE_F32,
  UNDERSTORY_RING_GROUP_COUNT,
  UNDERSTORY_RING_PARAM_BYTES,
  packUnderstoryRingClassParams,
  packUnderstoryRingParams,
  resolveUnderstoryRingReadbackCounts,
  understoryRingCell,
  understoryRingGrid,
  understoryRingRequestsDebugReadback,
  understoryRingSlotCount,
  understoryRingWorkgroupSize,
  type UnderstoryRingCounts,
} from "../understory/understory_ring_math.js";
import { getDigEditsSnapshot, getDigEditRevision, surfaceHeight } from "../terrain/terrain.js";
import { DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG } from "../vegetation/terrain_rejection_config.js";
import { buildVegetationSlotPrefilter, VegetationSlotPrefilterCache } from "../vegetation/vegetation_slot_prefilter.js";

const CLASS_PARAMS_BYTES = UNDERSTORY_RING_GROUP_COUNT * UNDERSTORY_RING_CLASS_STRIDE_F32 * Float32Array.BYTES_PER_ELEMENT;
const COUNTER_BYTES = UNDERSTORY_RING_GROUP_COUNT * Uint32Array.BYTES_PER_ELEMENT;
const READBACK_SLOTS = 2;
const ACTIVE_SLOT_SENTINEL = 0xffffffff;
const PREFILTER_CLUSTER_DIM_SLOTS = 16;
const CAMERA_HEIGHT_FALLBACK_M = 48;

export const UNDERSTORY_GPU_RING_STORAGE_BINDINGS = 6;

export interface UnderstoryGpuRingOutputBuffers { cell: GPUBuffer; indirectArgs: GPUBuffer }
export interface UnderstoryHydrologyData { res: number; worldCells: number; data: Float32Array }
export interface UnderstoryGpuRingStats {
  status: "initializing" | "idle" | "running" | "ready" | "failed" | "disabled";
  reason?: string;
  candidateCount: number;
  candidateCountBeforePrefilter?: number;
  candidateCountAfterPrefilter?: number;
  prefilterTestedClusters?: number;
  prefilterRejectedClusters?: number;
  prefilterAcceptedClusters?: number;
  prefilterUnknownKeptClusters?: number;
  prefilterFarSummaryConsulted?: number;
  prefilterSourceFarSummary?: number;
  prefilterSourceTerrainSampler?: number;
  prefilterSourceFallback?: number;
  acceptedCandidates: number;
  counts: UnderstoryRingCounts;
  groupCounts: number[];
  overflowed: boolean;
  submitMs: number | null;
  readbackMs: number | null;
  skippedDispatches: number;
}
export interface UnderstoryGpuRingDispatchParams {
  centerX: number;
  centerZ: number;
  worldCells: number;
  maxInstancesPerGroup: number;
  indexCounts: [number, number, number, number, number, number];
  frustumPlanes: ArrayLike<number>;
  hydroEnabled?: boolean;
  activeSlotIndices?: Uint32Array;
  candidateCountBeforePrefilter?: number;
  candidateCountAfterPrefilter?: number;
}
interface ReadbackSlot { buffer: GPUBuffer; busy: boolean; destroyAfterMap: boolean; cpu: Uint32Array }
type PipelineName = "clear_counters" | "understory_cull" | "build_indirect_args";

export function understoryGpuRingComputeUnsupportedReason(device: GPUDevice): string | null {
  const maxStorageBuffers = device.limits.maxStorageBuffersPerShaderStage;
  if (maxStorageBuffers >= UNDERSTORY_GPU_RING_STORAGE_BINDINGS) return null;
  return `understory ring compute requires ${UNDERSTORY_GPU_RING_STORAGE_BINDINGS} storage buffers per shader stage; device limit is ${maxStorageBuffers}`;
}

export class UnderstoryGpuRingCompute {
  private readonly paramBuffer: GPUBuffer;
  private readonly classParamsBuffer: GPUBuffer;
  private readonly counterBuffer: GPUBuffer;
  private readonly counterReadbacks: ReadbackSlot[];
  private readonly fieldParams: GPUBuffer;
  private readonly activeSlotBuffer: GPUBuffer;
  private readonly fullSlotIndices: Uint32Array;
  private activeSlotScratch = new Uint32Array(0);
  private digEdits: GPUBuffer;
  private bindGroup: GPUBindGroup;
  private readonly hydroTexture: GPUTexture;
  private readonly hydroSampler: GPUSampler;
  private readonly paramScratch = new ArrayBuffer(UNDERSTORY_RING_PARAM_BYTES);
  private readonly classParamsScratch = new Float32Array(UNDERSTORY_RING_GROUP_COUNT * UNDERSTORY_RING_CLASS_STRIDE_F32);
  private readonly pipelines: Record<PipelineName, GPUComputePipeline>;
  private readonly slotPrefilterCache = new VegetationSlotPrefilterCache();
  private counts: UnderstoryRingCounts = { shrub: 0, fern: 0, sapling: 0, flower: 0, dead_log: 0, stump: 0 };
  private groupCounts = new Array<number>(UNDERSTORY_RING_GROUP_COUNT).fill(0);
  private overflowed = false;
  private candidateCountBeforePrefilter = 0;
  private candidateCountAfterPrefilter = 0;
  private prefilterTestedClusters = 0;
  private prefilterRejectedClusters = 0;
  private prefilterAcceptedClusters = 0;
  private prefilterUnknownKeptClusters = 0;
  private prefilterFarSummaryConsulted = 0;
  private prefilterSourceFarSummary = 0;
  private prefilterSourceTerrainSampler = 0;
  private prefilterSourceFallback = 0;
  private runningReadbacks = 0;
  private failedReason: string | null = null;
  private submitMs: number | null = null;
  private readbackMs: number | null = null;
  private skippedDispatches = 0;
  private generation = 0;
  private frame = 0;
  private lastDigEditRevision = -1;

  private constructor(
    private readonly device: GPUDevice,
    private readonly layout: GPUBindGroupLayout,
    pipelines: Record<PipelineName, GPUComputePipeline>,
    edits: readonly ResolvedDigEdit[],
    private readonly outputBuffers: UnderstoryGpuRingOutputBuffers,
    private readonly settings: UnderstorySettings,
    hydroData: UnderstoryHydrologyData | null,
  ) {
    this.pipelines = pipelines;
    const slotCount = understoryRingSlotCount(settings);
    this.candidateCountBeforePrefilter = slotCount;
    this.candidateCountAfterPrefilter = slotCount;
    this.fullSlotIndices = fullSlotIndices(slotCount);
    const activeSlotCapacity = Math.max(understoryRingWorkgroupSize(settings), roundUp(slotCount, understoryRingWorkgroupSize(settings)));
    this.paramBuffer = device.createBuffer({ label: "understory ring params", size: UNDERSTORY_RING_PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.classParamsBuffer = device.createBuffer({ label: "understory ring class params", size: CLASS_PARAMS_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.counterBuffer = device.createBuffer({ label: "understory ring counters", size: COUNTER_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.fieldParams = device.createBuffer({ label: "understory ring field params", size: FIELD_PARAM_WORDS * Uint32Array.BYTES_PER_ELEMENT, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.activeSlotBuffer = device.createBuffer({ label: "understory ring active slot indices", size: activeSlotCapacity * Uint32Array.BYTES_PER_ELEMENT, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.digEdits = this.createDigEditsBuffer(edits);
    this.writeFieldParams(edits.length);
    this.counterReadbacks = Array.from({ length: READBACK_SLOTS }, (_, index) => ({
      buffer: device.createBuffer({ label: `understory ring counter readback ${index}`, size: COUNTER_BYTES, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
      busy: false,
      destroyAfterMap: false,
      cpu: new Uint32Array(UNDERSTORY_RING_GROUP_COUNT),
    }));
    if (hydroData && hydroData.data.length > 0) {
      this.hydroTexture = device.createTexture({ label: "understory ring hydro texture", size: { width: hydroData.res, height: hydroData.res }, format: "rgba32float", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
      const bytes = new Uint8Array(hydroData.data.byteLength);
      bytes.set(new Uint8Array(hydroData.data.buffer, hydroData.data.byteOffset, hydroData.data.byteLength));
      device.queue.writeTexture({ texture: this.hydroTexture }, bytes, { bytesPerRow: hydroData.res * 16 }, { width: hydroData.res, height: hydroData.res });
    } else {
      this.hydroTexture = device.createTexture({ label: "understory ring fallback hydro texture", size: { width: 1, height: 1 }, format: "rgba32float", usage: GPUTextureUsage.TEXTURE_BINDING });
    }
    this.hydroSampler = device.createSampler({ label: "understory ring hydro sampler", magFilter: "nearest", minFilter: "nearest" });
    this.bindGroup = this.createBindGroup();
  }

  static async create(device: GPUDevice, edits: readonly ResolvedDigEdit[], outputBuffers: UnderstoryGpuRingOutputBuffers, settings: UnderstorySettings, hydroData: UnderstoryHydrologyData | null = null): Promise<UnderstoryGpuRingCompute> {
    const module = device.createShaderModule({ label: "understory ring compute shader", code: composeUnderstoryRingShader(settings.gpu.workgroupSize) });
    const storage = (binding: number, type: GPUBufferBindingType = "storage"): GPUBindGroupLayoutEntry => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type } });
    const layout = device.createBindGroupLayout({ label: "understory ring compute layout", entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      storage(1), storage(2), storage(3), storage(4, "read-only-storage"),
      { binding: 5, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, sampler: {} },
      storage(7, "read-only-storage"),
      { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      storage(9, "read-only-storage"),
    ] });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const makePipeline = (entryPoint: PipelineName) => device.createComputePipelineAsync({ label: `understory ring ${entryPoint}`, layout: pipelineLayout, compute: { module, entryPoint } });
    const [clearCounters, cull, buildIndirectArgs] = await Promise.all([makePipeline("clear_counters"), makePipeline("understory_cull"), makePipeline("build_indirect_args")]);
    return new UnderstoryGpuRingCompute(device, layout, { clear_counters: clearCounters, understory_cull: cull, build_indirect_args: buildIndirectArgs }, edits, outputBuffers, { ...settings }, hydroData);
  }

  updateDigEdits(edits: readonly ResolvedDigEdit[]): void {
    const previous = this.digEdits;
    this.digEdits = this.createDigEditsBuffer(edits);
    this.writeFieldParams(edits.length);
    this.bindGroup = this.createBindGroup();
    this.slotPrefilterCache.clear();
    previous.destroy();
    this.failedReason = null;
  }

  dispatch(params: UnderstoryGpuRingDispatchParams): boolean {
    if (this.failedReason) return false;
    this.syncDigEdits();
    const frame = this.frame++;
    const requestReadback = understoryRingRequestsDebugReadback(this.settings, frame);
    const readbackSlot = requestReadback ? this.counterReadbacks.find((candidate) => !candidate.busy) ?? null : null;
    if (requestReadback && !readbackSlot) this.skippedDispatches++;
    const prefilter = params.activeSlotIndices ? null : this.buildSlotPrefilter(params);
    this.prefilterTestedClusters = prefilter ? prefilter.clusterGrid * prefilter.clusterGrid : 0;
    this.prefilterRejectedClusters = prefilter?.rejectedClusters ?? 0;
    this.prefilterAcceptedClusters = prefilter?.visibleClusters ?? 0;
    this.prefilterUnknownKeptClusters = prefilter?.unknownKeptClusters ?? 0;
    this.prefilterFarSummaryConsulted = prefilter?.farSummaryConsultedClusters ?? 0;
    this.prefilterSourceFarSummary = prefilter?.sourceCounts.naadfFarSummary ?? 0;
    this.prefilterSourceTerrainSampler = prefilter?.sourceCounts.terrainVisibilitySampler ?? 0;
    this.prefilterSourceFallback = prefilter?.sourceCounts.conservativeFallback ?? 0;
    const activeSlots = this.prepareActiveSlotIndices(params.activeSlotIndices ?? prefilter?.activeSlotIndices);
    this.candidateCountBeforePrefilter = Math.max(0, Math.floor(params.candidateCountBeforePrefilter ?? prefilter?.candidateSlotsBeforePrefilter ?? understoryRingSlotCount(this.settings)));
    this.candidateCountAfterPrefilter = Math.max(0, Math.floor(params.candidateCountAfterPrefilter ?? prefilter?.candidateSlotsAfterPrefilter ?? activeSlots.count));
    packUnderstoryRingParams(this.settings, params, this.paramScratch);
    this.device.queue.writeBuffer(this.paramBuffer, 0, this.paramScratch);
    this.device.queue.writeBuffer(this.activeSlotBuffer, 0, activeSlots.data.buffer, activeSlots.data.byteOffset, activeSlots.data.byteLength);
    packUnderstoryRingClassParams(this.settings, this.classParamsScratch);
    this.device.queue.writeBuffer(this.classParamsBuffer, 0, this.classParamsScratch);
    const encoder = this.device.createCommandEncoder({ label: "understory ring compute encoder" });
    this.dispatchPipeline(encoder, this.pipelines.clear_counters, 1);
    this.dispatchPipeline(encoder, this.pipelines.understory_cull, activeCullWorkgroups(this.settings, activeSlots.paddedCount));
    this.dispatchPipeline(encoder, this.pipelines.build_indirect_args, 1);
    if (readbackSlot) encoder.copyBufferToBuffer(this.counterBuffer, 0, readbackSlot.buffer, 0, COUNTER_BYTES);
    const submittedGeneration = this.generation;
    const submitStart = performance.now();
    if (readbackSlot) { readbackSlot.busy = true; readbackSlot.destroyAfterMap = false; this.runningReadbacks++; }
    this.device.queue.submit([encoder.finish()]);
    this.submitMs = performance.now() - submitStart;
    if (readbackSlot) this.readback(readbackSlot, submittedGeneration, params.maxInstancesPerGroup);
    return true;
  }

  stats(enabled: boolean): UnderstoryGpuRingStats {
    const acceptedCandidates = Object.values(this.counts).reduce((a, b) => a + b, 0);
    return {
      status: !enabled ? "disabled" : this.failedReason ? "failed" : this.runningReadbacks > 0 ? "running" : "ready",
      reason: this.failedReason ?? undefined,
      candidateCount: this.candidateCountAfterPrefilter,
      candidateCountBeforePrefilter: this.candidateCountBeforePrefilter,
      candidateCountAfterPrefilter: this.candidateCountAfterPrefilter,
      prefilterTestedClusters: this.prefilterTestedClusters,
      prefilterRejectedClusters: this.prefilterRejectedClusters,
      prefilterAcceptedClusters: this.prefilterAcceptedClusters,
      prefilterUnknownKeptClusters: this.prefilterUnknownKeptClusters,
      prefilterFarSummaryConsulted: this.prefilterFarSummaryConsulted,
      prefilterSourceFarSummary: this.prefilterSourceFarSummary,
      prefilterSourceTerrainSampler: this.prefilterSourceTerrainSampler,
      prefilterSourceFallback: this.prefilterSourceFallback,
      acceptedCandidates,
      counts: { ...this.counts },
      groupCounts: [...this.groupCounts],
      overflowed: this.overflowed,
      submitMs: this.submitMs,
      readbackMs: this.readbackMs,
      skippedDispatches: this.skippedDispatches,
    };
  }

  destroy(): void {
    this.generation++;
    this.runningReadbacks = 0;
    this.paramBuffer.destroy();
    this.classParamsBuffer.destroy();
    this.counterBuffer.destroy();
    this.activeSlotBuffer.destroy();
    this.digEdits.destroy();
    this.fieldParams.destroy();
    this.hydroTexture.destroy();
    for (const slot of this.counterReadbacks) if (slot.busy) slot.destroyAfterMap = true; else slot.buffer.destroy();
  }

  private syncDigEdits(): void {
    const revision = getDigEditRevision();
    if (revision === this.lastDigEditRevision) return;
    this.updateDigEdits(resolveDigEdits(getDigEditsSnapshot()));
    this.lastDigEditRevision = revision;
  }

  private createBindGroup(): GPUBindGroup {
    return this.device.createBindGroup({ label: "understory ring bind group", layout: this.layout, entries: [
      { binding: 0, resource: { buffer: this.paramBuffer } },
      { binding: 1, resource: { buffer: this.counterBuffer } },
      { binding: 2, resource: { buffer: this.outputBuffers.indirectArgs } },
      { binding: 3, resource: { buffer: this.outputBuffers.cell } },
      { binding: 4, resource: { buffer: this.classParamsBuffer } },
      { binding: 5, resource: this.hydroTexture.createView() },
      { binding: 6, resource: this.hydroSampler },
      { binding: 7, resource: { buffer: this.digEdits } },
      { binding: 8, resource: { buffer: this.fieldParams } },
      { binding: 9, resource: { buffer: this.activeSlotBuffer } },
    ] });
  }

  private createDigEditsBuffer(edits: readonly ResolvedDigEdit[]): GPUBuffer {
    const buffer = this.device.createBuffer({ label: "understory ring dig edits", size: Math.max(1, edits.length) * DIG_EDIT_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(buffer, 0, packDigEdits(edits));
    return buffer;
  }

  private writeFieldParams(editCount: number): void {
    const packedFieldParams = packFieldParams(editCount);
    this.device.queue.writeBuffer(this.fieldParams, 0, packedFieldParams.buffer as ArrayBuffer, packedFieldParams.byteOffset, packedFieldParams.byteLength);
  }

  private dispatchPipeline(encoder: GPUCommandEncoder, pipeline: GPUComputePipeline, workgroups: number): void {
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.max(1, workgroups));
    pass.end();
  }

  private buildSlotPrefilter(params: UnderstoryGpuRingDispatchParams) {
    const config = DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG;
    if (!config.enabled || !config.viewRulesEnabled) return null;
    const cameraGround = surfaceHeight(params.centerX, params.centerZ);
    const cameraY = Number.isFinite(cameraGround) ? cameraGround + CAMERA_HEIGHT_FALLBACK_M : this.settings.placement.maxHeightM + CAMERA_HEIGHT_FALLBACK_M;
    return buildVegetationSlotPrefilter({
      kind: "understory",
      centerX: params.centerX,
      centerZ: params.centerZ,
      cameraY,
      worldCells: params.worldCells,
      unbounded: getTerrainFieldCoreConfig().islandShape.enabled,
      grid: understoryRingGrid(this.settings),
      cell: understoryRingCell(this.settings),
      clusterDimSlots: PREFILTER_CLUSTER_DIM_SLOTS,
      visibility: { enabled: true, minDistanceM: config.viewMinDistanceM, sampleCount: config.viewSampleCount, heightMarginM: config.viewHeightMarginM, crownHeightM: config.understoryCrownHeightM },
      sampler: { sampleHeight: (x, z) => { const height = surfaceHeight(x, z); return { height, unknown: !Number.isFinite(height) }; } },
      terrainRevision: getDigEditRevision(),
      cache: this.slotPrefilterCache,
    });
  }

  private prepareActiveSlotIndices(source: Uint32Array | undefined): { data: Uint32Array; count: number; paddedCount: number } {
    const slotCount = understoryRingSlotCount(this.settings);
    const input = source ?? this.fullSlotIndices;
    const count = Math.min(input.length, slotCount);
    const paddedCount = Math.max(understoryRingWorkgroupSize(this.settings), roundUp(Math.max(1, count), understoryRingWorkgroupSize(this.settings)));
    if (this.activeSlotScratch.length < paddedCount) this.activeSlotScratch = new Uint32Array(paddedCount);
    this.activeSlotScratch.fill(ACTIVE_SLOT_SENTINEL, 0, paddedCount);
    if (count > 0) this.activeSlotScratch.set(input.subarray(0, count), 0);
    return { data: this.activeSlotScratch.subarray(0, paddedCount), count, paddedCount };
  }

  private readback(slot: ReadbackSlot, submittedGeneration: number, maxInstancesPerGroup: number): void {
    const readbackStart = performance.now();
    void slot.buffer.mapAsync(GPUMapMode.READ).then(() => {
      if (submittedGeneration !== this.generation) { slot.busy = false; slot.destroyAfterMap = false; this.runningReadbacks = Math.max(0, this.runningReadbacks - 1); slot.buffer.unmap(); slot.buffer.destroy(); return; }
      slot.cpu.set(new Uint32Array(slot.buffer.getMappedRange(0, COUNTER_BYTES)));
      slot.buffer.unmap();
      slot.busy = false;
      this.runningReadbacks = Math.max(0, this.runningReadbacks - 1);
      this.readbackMs = performance.now() - readbackStart;
      const resolved = resolveUnderstoryRingReadbackCounts(slot.cpu, maxInstancesPerGroup);
      this.groupCounts = resolved.groupCounts;
      this.counts = resolved.counts;
      this.overflowed = resolved.overflowed;
      if (slot.destroyAfterMap) { slot.destroyAfterMap = false; slot.buffer.destroy(); }
    }).catch((error) => {
      if (submittedGeneration !== this.generation) { slot.busy = false; slot.destroyAfterMap = false; this.runningReadbacks = Math.max(0, this.runningReadbacks - 1); slot.buffer.destroy(); return; }
      slot.busy = false;
      this.runningReadbacks = Math.max(0, this.runningReadbacks - 1);
      if (slot.destroyAfterMap) { slot.destroyAfterMap = false; slot.buffer.destroy(); return; }
      this.failedReason = error instanceof Error ? error.message : String(error);
    });
  }
}

function activeCullWorkgroups(settings: UnderstorySettings, activeSlotCount: number): number {
  return Math.max(1, Math.ceil(Math.max(1, Math.floor(activeSlotCount)) / understoryRingWorkgroupSize(settings)));
}
function roundUp(value: number, step: number): number {
  const safeStep = Math.max(1, Math.floor(step));
  return Math.ceil(Math.max(0, Math.floor(value)) / safeStep) * safeStep;
}
function fullSlotIndices(slotCount: number): Uint32Array {
  const result = new Uint32Array(Math.max(0, Math.floor(slotCount)));
  for (let i = 0; i < result.length; i++) result[i] = i;
  return result;
}

export * from "./understory_ring_draw_resources.js";
