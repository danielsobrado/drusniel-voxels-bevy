import { DIG_EDIT_BYTES, FIELD_PARAM_WORDS, packDigEdits, packFieldParams } from "./gpu_mesh_buffers.js";
import { createGrassGpuRingFallbackOutputBuffers, createGrassHydrologyTexture } from "./grass_ring_compute_resources.js";
import { getTerrainFieldCoreConfig, type ResolvedDigEdit } from "./terrain_field_core.js";
import { composeGrassRingShader } from "./wgsl_modules.js";
import { DEFAULT_GRASS_SETTINGS, type GrassRingSettings, type GrassSettings } from "../grass/grass_config.js";
import { grassHeightDensityVector, grassMaterialDensityVector } from "../grass/grass_material_bias.js";
import { shouldRequestGpuReadback } from "../diagnostics/gpu_readback_policy.js";
import { getDigEditRevision, surfaceHeight } from "../terrain/terrain.js";
import { DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG } from "../vegetation/terrain_rejection_config.js";
import {
  buildVegetationSlotPrefilter,
  VegetationSlotPrefilterCache,
} from "../vegetation/vegetation_slot_prefilter.js";

const WORKGROUP_SIZE = 64;
const PARAM_BYTES = 16 * 17;
const COUNTER_BYTES = 4 * Uint32Array.BYTES_PER_ELEMENT;
const INDIRECT_ARGS_PER_TIER = 5;
const TIER_COUNT = 4;
const INDIRECT_BYTES = TIER_COUNT * INDIRECT_ARGS_PER_TIER * Uint32Array.BYTES_PER_ELEMENT;
const READBACK_SLOTS = 2;
const READBACK_INTERVAL_FRAMES = 90;
const ACTIVE_SLOT_SENTINEL = 0xffffffff;
const GRASS_PREFILTER_CLUSTER_DIM_SLOTS = 16;
const GRASS_CAMERA_HEIGHT_FALLBACK_M = 32;
const DEFAULT_MATERIAL_DENSITY: [number, number, number, number] = [1, 1, 1, 1];
const DEFAULT_HEIGHT_DENSITY: [number, number, number, number, number, number] = [14, 34, 8, 1, 1, 1];
export const GRASS_GPU_RING_MAX_SAFE_GRID = 384;

export const GRASS_GPU_RING_GRID = DEFAULT_GRASS_SETTINGS.ring.grid;
export const GRASS_GPU_RING_CELL = DEFAULT_GRASS_SETTINGS.ring.cell;
export const GRASS_GPU_RING_SLOT_COUNT = GRASS_GPU_RING_GRID * GRASS_GPU_RING_GRID;
export const GRASS_GPU_RING_STORAGE_BINDINGS = 8;

export interface GrassHydrologyData {
  res: number;
  worldCells: number;
  data: Float32Array;
}

export function grassGpuRingGrid(ring: Pick<GrassRingSettings, "grid"> = DEFAULT_GRASS_SETTINGS.ring): number {
  const grid = Number.isFinite(ring.grid) ? ring.grid : DEFAULT_GRASS_SETTINGS.ring.grid;
  return Math.min(GRASS_GPU_RING_MAX_SAFE_GRID, Math.max(1, Math.floor(grid)));
}

export function grassGpuRingCell(ring: Pick<GrassRingSettings, "cell"> = DEFAULT_GRASS_SETTINGS.ring): number {
  const cell = Number.isFinite(ring.cell) ? ring.cell : DEFAULT_GRASS_SETTINGS.ring.cell;
  return Math.max(0.1, cell);
}

export function grassGpuRingSlotCount(ring: Pick<GrassRingSettings, "grid"> = DEFAULT_GRASS_SETTINGS.ring): number {
  const grid = grassGpuRingGrid(ring);
  return grid * grid;
}

export function grassGpuRingActiveCullWorkgroups(activeSlotCount: number): number {
  return Math.max(1, Math.ceil(Math.max(1, Math.floor(activeSlotCount)) / WORKGROUP_SIZE));
}

export function grassGpuRingComputeUnsupportedReason(device: GPUDevice): string | null {
  const maxStorageBuffers = device.limits.maxStorageBuffersPerShaderStage;
  if (maxStorageBuffers >= GRASS_GPU_RING_STORAGE_BINDINGS) return null;
  return `grass ring compute requires ${GRASS_GPU_RING_STORAGE_BINDINGS} storage buffers per shader stage; device limit is ${maxStorageBuffers}`;
}

export interface GrassGpuRingBands {
  near: number;
  mid: number;
  far: number;
  radius: number;
}

export interface GrassGpuRingDispatchParams {
  centerX: number;
  centerZ: number;
  worldCells: number;
  bands: GrassGpuRingBands;
  density: GrassGpuRingDensityParams;
  bladeHeight: number;
  bladeHeightVariation: number;
  slopeMinY: number;
  minHeight: number;
  maxHeight: number;
  maxInstancesPerTier: number;
  seed: number;
  jitter: number;
  materialDensity?: [number, number, number, number];
  heightDensity?: [number, number, number, number, number, number];
  frustumPlanes?: ArrayLike<number>;
  activeSlotIndices?: Uint32Array;
  candidateCountBeforePrefilter?: number;
  candidateCountAfterPrefilter?: number;
}

export interface GrassGpuRingDensityParams {
  nearDistance: number;
  midDistance: number;
  farEnd: number;
  midInstanceFraction: number;
  farDensityRatio: number;
  farInstanceFraction: number;
  maxWidthCompensation: number;
  scruffMinDensity: number;
  gustStrength: number;
  materialDensity?: [number, number, number, number];
  heightDensity?: [number, number, number, number, number, number];
}

export interface GrassGpuRingIndexCounts {
  near: number;
  mid: number;
  far: number;
  super: number;
}

export interface GrassGpuTierOutputBuffers {
  offset: GPUBuffer;
  packed0: GPUBuffer;
  packed1: GPUBuffer;
  terrainNormal: GPUBuffer;
}

export interface GrassGpuRingOutputBuffers {
  near: GrassGpuTierOutputBuffers;
  mid: GrassGpuTierOutputBuffers;
  far: GrassGpuTierOutputBuffers;
  super: GrassGpuTierOutputBuffers;
  indirectArgs: GPUBuffer;
}

export interface GrassGpuRingCounts {
  near: number;
  mid: number;
  far: number;
  super: number;
}

export interface GrassGpuRingStats {
  status: "initializing" | "idle" | "running" | "ready" | "failed" | "disabled" | "fallback-cpu" | "unsupported";
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
  generatedCandidates: number;
  acceptedCandidates: number;
  counts: GrassGpuRingCounts;
  submitMs: number | null;
  readbackMs: number | null;
  skippedDispatches: number;
}

interface ReadbackSlot {
  buffer: GPUBuffer;
  busy: boolean;
  destroyAfterMap: boolean;
  cpu: Uint32Array;
}

type PipelineName = "clear_counters" | "grass_cull" | "build_indirect_args";

export interface GrassGpuRingTierRegion {
  start: number;
  end: number;
  firstInstance: number;
}

export function grassGpuRingTierRegion(tier: number, maxInstancesPerTier: number): GrassGpuRingTierRegion {
  const start = Math.max(0, Math.floor(tier)) * Math.max(0, Math.floor(maxInstancesPerTier));
  return { start, end: start + Math.max(0, Math.floor(maxInstancesPerTier)), firstInstance: start };
}

export function grassGpuRingOutputIndex(tier: number, slot: number, maxInstancesPerTier: number): number {
  return grassGpuRingTierRegion(tier, maxInstancesPerTier).start + Math.max(0, Math.floor(slot));
}

export function grassGpuRingDensityParams(
  settings: Pick<GrassSettings, "distance" | "lod" | "ring" | "blade" | "wind">,
): GrassGpuRingDensityParams {
  const nearDistance = settings.distance * settings.lod.nearFraction;
  const midDistance = settings.distance * settings.lod.midFraction;
  const maybeFullSettings = settings as GrassSettings;
  return {
    nearDistance,
    midDistance,
    farEnd: Math.max(midDistance + 0.001, settings.distance, settings.ring.farMeters),
    midInstanceFraction: settings.lod.midInstanceFraction,
    farDensityRatio: settings.lod.farDensityRatio,
    farInstanceFraction: settings.lod.farInstanceFraction,
    maxWidthCompensation: settings.blade.maxWidthCompensation,
    scruffMinDensity: settings.ring.scruffMinDensity,
    gustStrength: settings.wind.gustStrength,
    materialDensity: grassMaterialDensityVector(maybeFullSettings),
    heightDensity: grassHeightDensityVector(maybeFullSettings),
  };
}

export function grassGpuRingMaterialDensity(settings: GrassSettings): [number, number, number, number] {
  return grassMaterialDensityVector(settings);
}

export function grassGpuRingHeightDensity(settings: GrassSettings): [number, number, number, number, number, number] {
  return grassHeightDensityVector(settings);
}

export function packGrassGpuRingParams(
  params: GrassGpuRingDispatchParams,
  indexCounts: GrassGpuRingIndexCounts,
  ring: GrassRingSettings = DEFAULT_GRASS_SETTINGS.ring,
  scratch: ArrayBuffer = new ArrayBuffer(PARAM_BYTES),
): ArrayBuffer {
  const f32 = new Float32Array(scratch);
  const u32 = new Uint32Array(scratch);
  f32.fill(0);
  u32.fill(0);
  f32[0] = params.centerX;
  f32[1] = params.centerZ;
  f32[2] = params.bands.radius;
  f32[3] = params.worldCells;
  f32[4] = params.bands.near;
  f32[5] = params.bands.mid;
  f32[6] = params.bands.far;
  f32[7] = ring.bandMeters;
  f32[8] = grassGpuRingCell(ring);
  f32[9] = params.bladeHeight;
  f32[10] = params.bladeHeightVariation;
  f32[11] = params.slopeMinY;
  f32[12] = params.minHeight;
  f32[13] = params.maxHeight;
  f32[14] = ring.scruffMeters;
  f32[15] = params.density.maxWidthCompensation;
  u32[16] = indexCounts.near;
  u32[17] = indexCounts.mid;
  u32[18] = indexCounts.far;
  u32[19] = indexCounts.super;
  u32[20] = Math.max(0, Math.floor(params.maxInstancesPerTier));
  u32[21] = grassGpuRingGrid(ring);
  u32[22] = params.seed >>> 0;
  f32[24] = params.density.nearDistance;
  f32[25] = params.density.midDistance;
  f32[26] = params.density.farEnd;
  f32[27] = params.density.midInstanceFraction;
  f32[28] = params.density.farDensityRatio;
  f32[29] = params.density.farInstanceFraction;
  f32[30] = params.density.scruffMinDensity;
  f32[31] = params.jitter;

  const material = params.materialDensity ?? params.density.materialDensity ?? DEFAULT_MATERIAL_DENSITY;
  const height = params.heightDensity ?? params.density.heightDensity ?? DEFAULT_HEIGHT_DENSITY;
  for (let i = 0; i < 4; i++) f32[32 + i] = material[i] ?? 1;
  f32[36] = height[0] ?? DEFAULT_HEIGHT_DENSITY[0];
  f32[37] = height[1] ?? DEFAULT_HEIGHT_DENSITY[1];
  f32[38] = height[2] ?? DEFAULT_HEIGHT_DENSITY[2];
  f32[39] = height[3] ?? DEFAULT_HEIGHT_DENSITY[3];
  f32[40] = height[4] ?? DEFAULT_HEIGHT_DENSITY[4];
  f32[41] = height[5] ?? DEFAULT_HEIGHT_DENSITY[5];

  if (params.frustumPlanes) {
    for (let i = 0; i < Math.min(24, params.frustumPlanes.length); i++) f32[44 + i] = params.frustumPlanes[i] ?? 0;
  }
  return scratch;
}

export class GrassGpuRingCompute {
  private readonly paramBuffer: GPUBuffer;
  private readonly counterBuffer: GPUBuffer;
  private readonly counterReadbacks: ReadbackSlot[];
  private readonly indirectArgs: GPUBuffer;
  private readonly outputBuffers: GrassGpuRingOutputBuffers | null;
  private readonly fallbackOutputBuffers: GrassGpuRingOutputBuffers | null;
  private readonly fieldParams: GPUBuffer;
  private readonly activeSlotBuffer: GPUBuffer;
  private readonly fullSlotIndices: Uint32Array;
  private activeSlotScratch = new Uint32Array(0);
  private readonly slotPrefilterCache = new VegetationSlotPrefilterCache();
  private digEdits: GPUBuffer;
  private bindGroup: GPUBindGroup;
  private readonly hydroTexture: GPUTexture;
  private readonly hydroSampler: GPUSampler;
  private readonly paramScratch = new ArrayBuffer(PARAM_BYTES);
  private readonly pipelines: Record<PipelineName, GPUComputePipeline>;
  private counts: GrassGpuRingCounts = { near: 0, mid: 0, far: 0, super: 0 };
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

  private constructor(
    private readonly device: GPUDevice,
    private readonly layout: GPUBindGroupLayout,
    pipelines: Record<PipelineName, GPUComputePipeline>,
    edits: readonly ResolvedDigEdit[],
    outputBuffers: GrassGpuRingOutputBuffers | null,
    private readonly ring: GrassRingSettings,
    hydroData: GrassHydrologyData | null,
  ) {
    this.pipelines = pipelines;
    this.outputBuffers = outputBuffers;
    const slotCount = grassGpuRingSlotCount(ring);
    this.candidateCountBeforePrefilter = slotCount;
    this.candidateCountAfterPrefilter = slotCount;
    this.fullSlotIndices = makeFullSlotIndices(slotCount);
    const activeSlotCapacity = Math.max(WORKGROUP_SIZE, roundUp(slotCount, WORKGROUP_SIZE));
    this.paramBuffer = device.createBuffer({ label: "grass ring params", size: PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.counterBuffer = device.createBuffer({ label: "grass ring counters", size: COUNTER_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.indirectArgs = outputBuffers?.indirectArgs ?? device.createBuffer({ label: "grass ring indirect args", size: INDIRECT_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC });
    this.fallbackOutputBuffers = outputBuffers ? null : createGrassGpuRingFallbackOutputBuffers(this.device, slotCount, this.indirectArgs);
    this.fieldParams = device.createBuffer({ label: "grass ring field params", size: FIELD_PARAM_WORDS * Uint32Array.BYTES_PER_ELEMENT, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.activeSlotBuffer = device.createBuffer({ label: "grass ring active slot indices", size: activeSlotCapacity * Uint32Array.BYTES_PER_ELEMENT, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.digEdits = this.createDigEditsBuffer(edits);
    this.writeFieldParams(edits.length);
    this.counterReadbacks = Array.from({ length: READBACK_SLOTS }, (_, index) => ({
      buffer: device.createBuffer({ label: `grass ring counter readback ${index}`, size: COUNTER_BYTES, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
      busy: false,
      destroyAfterMap: false,
      cpu: new Uint32Array(TIER_COUNT),
    }));
    this.hydroTexture = createGrassHydrologyTexture(device, hydroData);
    this.hydroSampler = device.createSampler({ label: "grass ring hydro sampler", magFilter: "nearest", minFilter: "nearest" });
    this.bindGroup = this.createBindGroup();
  }

  static async create(
    device: GPUDevice,
    edits: readonly ResolvedDigEdit[],
    outputBuffers: GrassGpuRingOutputBuffers | null = null,
    ring: GrassRingSettings = DEFAULT_GRASS_SETTINGS.ring,
    hydroData: GrassHydrologyData | null = null,
  ): Promise<GrassGpuRingCompute> {
    const module = device.createShaderModule({ label: "grass ring compute shader", code: composeGrassRingShader() });
    const storage = (binding: number, type: GPUBufferBindingType = "storage"): GPUBindGroupLayoutEntry => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type } });
    const layout = device.createBindGroupLayout({
      label: "grass ring compute layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        storage(1), storage(2), storage(3), storage(4), storage(5), storage(6), storage(7, "read-only-storage"),
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 9, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
        { binding: 10, visibility: GPUShaderStage.COMPUTE, sampler: {} },
        storage(11, "read-only-storage"),
      ],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const makePipeline = (entryPoint: PipelineName) => device.createComputePipelineAsync({ label: `grass ring ${entryPoint}`, layout: pipelineLayout, compute: { module, entryPoint } });
    const [clearCounters, cull, buildIndirectArgs] = await Promise.all([makePipeline("clear_counters"), makePipeline("grass_cull"), makePipeline("build_indirect_args")]);
    return new GrassGpuRingCompute(device, layout, { clear_counters: clearCounters, grass_cull: cull, build_indirect_args: buildIndirectArgs }, edits, outputBuffers, { ...ring }, hydroData);
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

  dispatch(params: GrassGpuRingDispatchParams, indexCounts: GrassGpuRingIndexCounts): boolean {
    if (this.failedReason) return false;

    const frame = this.frame++;
    const requestReadback = shouldRequestGpuReadback({ kind: "grass_gpu_counts", frame, intervalFrames: READBACK_INTERVAL_FRAMES });
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
    this.candidateCountBeforePrefilter = Math.max(0, Math.floor(params.candidateCountBeforePrefilter ?? prefilter?.candidateSlotsBeforePrefilter ?? grassGpuRingSlotCount(this.ring)));
    this.candidateCountAfterPrefilter = Math.max(0, Math.floor(params.candidateCountAfterPrefilter ?? prefilter?.candidateSlotsAfterPrefilter ?? activeSlots.count));
    packGrassGpuRingParams(params, indexCounts, this.ring, this.paramScratch);
    this.device.queue.writeBuffer(this.paramBuffer, 0, this.paramScratch);
    this.device.queue.writeBuffer(this.activeSlotBuffer, 0, activeSlots.data.buffer, activeSlots.data.byteOffset, activeSlots.data.byteLength);

    const encoder = this.device.createCommandEncoder({ label: "grass ring compute encoder" });
    this.dispatchPipeline(encoder, this.pipelines.clear_counters, 1);
    this.dispatchPipeline(encoder, this.pipelines.grass_cull, grassGpuRingActiveCullWorkgroups(activeSlots.paddedCount));
    this.dispatchPipeline(encoder, this.pipelines.build_indirect_args, 1);
    if (readbackSlot) encoder.copyBufferToBuffer(this.counterBuffer, 0, readbackSlot.buffer, 0, COUNTER_BYTES);

    const submittedGeneration = this.generation;
    const submitStart = performance.now();
    if (readbackSlot) { readbackSlot.busy = true; readbackSlot.destroyAfterMap = false; this.runningReadbacks++; }
    this.device.queue.submit([encoder.finish()]);
    this.submitMs = performance.now() - submitStart;
    if (readbackSlot) this.readback(readbackSlot, submittedGeneration, params.maxInstancesPerTier);
    return true;
  }

  stats(enabled: boolean): GrassGpuRingStats {
    const accepted = this.counts.near + this.counts.mid + this.counts.far + this.counts.super;
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
      generatedCandidates: this.candidateCountAfterPrefilter,
      acceptedCandidates: accepted,
      counts: { ...this.counts },
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
    this.activeSlotBuffer.destroy();
    this.digEdits.destroy();
    this.fieldParams.destroy();
    this.hydroTexture.destroy();
    if (this.fallbackOutputBuffers) destroyUniqueOutputBuffers(this.fallbackOutputBuffers, this.indirectArgs);
    if (!this.outputBuffers) this.indirectArgs.destroy();
    for (const slot of this.counterReadbacks) {
      if (slot.busy) slot.destroyAfterMap = true;
      else slot.buffer.destroy();
    }
  }

  private createBindGroup(): GPUBindGroup {
    return this.device.createBindGroup({
      label: "grass ring bind group",
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: this.paramBuffer } },
        { binding: 1, resource: { buffer: this.counterBuffer } },
        { binding: 2, resource: { buffer: this.indirectArgs } },
        ...this.outputBindGroupEntries(),
        { binding: 7, resource: { buffer: this.digEdits } },
        { binding: 8, resource: { buffer: this.fieldParams } },
        { binding: 9, resource: this.hydroTexture.createView() },
        { binding: 10, resource: this.hydroSampler },
        { binding: 11, resource: { buffer: this.activeSlotBuffer } },
      ],
    });
  }

  private createDigEditsBuffer(edits: readonly ResolvedDigEdit[]): GPUBuffer {
    const buffer = this.device.createBuffer({ label: "grass ring dig edits", size: Math.max(1, edits.length) * DIG_EDIT_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
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

  private outputBindGroupEntries(): GPUBindGroupEntry[] {
    const buffers = this.outputBuffers ?? this.fallbackOutputBuffers;
    if (!buffers) throw new Error("grass ring output buffers missing");
    return grassGpuRingOutputBindGroupEntries(buffers);
  }

  private buildSlotPrefilter(params: GrassGpuRingDispatchParams) {
    const config = DEFAULT_VEGETATION_TERRAIN_REJECTION_CONFIG;
    if (!config.enabled || !config.viewRulesEnabled) return null;
    const cameraGround = surfaceHeight(params.centerX, params.centerZ);
    const cameraY = Number.isFinite(cameraGround) ? cameraGround + GRASS_CAMERA_HEIGHT_FALLBACK_M : params.maxHeight + GRASS_CAMERA_HEIGHT_FALLBACK_M;
    return buildVegetationSlotPrefilter({
      kind: "grass",
      centerX: params.centerX,
      centerZ: params.centerZ,
      cameraY,
      worldCells: params.worldCells,
      unbounded: getTerrainFieldCoreConfig().islandShape.enabled,
      grid: grassGpuRingGrid(this.ring),
      cell: grassGpuRingCell(this.ring),
      clusterDimSlots: GRASS_PREFILTER_CLUSTER_DIM_SLOTS,
      visibility: { enabled: true, minDistanceM: config.viewMinDistanceM, sampleCount: config.viewSampleCount, heightMarginM: config.viewHeightMarginM, crownHeightM: config.grassCrownHeightM },
      sampler: { sampleHeight: (x, z) => { const height = surfaceHeight(x, z); return { height, unknown: !Number.isFinite(height) }; } },
      terrainRevision: getDigEditRevision(),
      cache: this.slotPrefilterCache,
    });
  }

  private prepareActiveSlotIndices(source: Uint32Array | undefined): { data: Uint32Array; count: number; paddedCount: number } {
    const slotCount = grassGpuRingSlotCount(this.ring);
    const input = source ?? this.fullSlotIndices;
    const count = Math.min(input.length, slotCount);
    const paddedCount = Math.max(WORKGROUP_SIZE, roundUp(Math.max(1, count), WORKGROUP_SIZE));
    if (this.activeSlotScratch.length < paddedCount) this.activeSlotScratch = new Uint32Array(paddedCount);
    this.activeSlotScratch.fill(ACTIVE_SLOT_SENTINEL, 0, paddedCount);
    if (count > 0) this.activeSlotScratch.set(input.subarray(0, count), 0);
    return { data: this.activeSlotScratch.subarray(0, paddedCount), count, paddedCount };
  }

  private readback(slot: ReadbackSlot, submittedGeneration: number, maxInstancesPerTier: number): void {
    const readbackStart = performance.now();
    void slot.buffer.mapAsync(GPUMapMode.READ).then(() => {
      if (submittedGeneration !== this.generation) {
        slot.busy = false;
        slot.destroyAfterMap = false;
        this.runningReadbacks = Math.max(0, this.runningReadbacks - 1);
        slot.buffer.unmap();
        slot.buffer.destroy();
        return;
      }
      slot.cpu.set(new Uint32Array(slot.buffer.getMappedRange(0, COUNTER_BYTES)));
      slot.buffer.unmap();
      slot.busy = false;
      this.runningReadbacks = Math.max(0, this.runningReadbacks - 1);
      this.readbackMs = performance.now() - readbackStart;
      const cap = Math.max(0, Math.floor(maxInstancesPerTier));
      this.counts = {
        near: Math.min(slot.cpu[0] ?? 0, cap),
        mid: Math.min(slot.cpu[1] ?? 0, cap),
        far: Math.min(slot.cpu[2] ?? 0, cap),
        super: Math.min(slot.cpu[3] ?? 0, cap),
      };
      if (slot.destroyAfterMap) { slot.destroyAfterMap = false; slot.buffer.destroy(); }
    }).catch((error) => {
      if (submittedGeneration !== this.generation) {
        slot.busy = false;
        slot.destroyAfterMap = false;
        this.runningReadbacks = Math.max(0, this.runningReadbacks - 1);
        slot.buffer.destroy();
        return;
      }
      slot.busy = false;
      this.runningReadbacks = Math.max(0, this.runningReadbacks - 1);
      if (slot.destroyAfterMap) { slot.destroyAfterMap = false; slot.buffer.destroy(); return; }
      this.failedReason = error instanceof Error ? error.message : String(error);
    });
  }
}

function destroyUniqueOutputBuffers(buffers: GrassGpuRingOutputBuffers, indirectArgs: GPUBuffer): void {
  const unique = new Set<GPUBuffer>();
  for (const tier of [buffers.near, buffers.mid, buffers.far, buffers.super]) {
    unique.add(tier.offset);
    unique.add(tier.packed0);
    unique.add(tier.packed1);
    unique.add(tier.terrainNormal);
  }
  unique.delete(indirectArgs);
  for (const buffer of unique) buffer.destroy();
}

function roundUp(value: number, step: number): number {
  const safeStep = Math.max(1, Math.floor(step));
  return Math.ceil(Math.max(0, Math.floor(value)) / safeStep) * safeStep;
}

function makeFullSlotIndices(slotCount: number): Uint32Array {
  const result = new Uint32Array(Math.max(0, Math.floor(slotCount)));
  for (let i = 0; i < result.length; i++) result[i] = i;
  return result;
}

export function grassGpuRingOutputBindGroupEntries(buffers: GrassGpuRingOutputBuffers): GPUBindGroupEntry[] {
  const shared = buffers.near;
  return [
    { binding: 3, resource: { buffer: shared.offset } },
    { binding: 4, resource: { buffer: shared.packed0 } },
    { binding: 5, resource: { buffer: shared.packed1 } },
    { binding: 6, resource: { buffer: shared.terrainNormal } },
  ];
}

export * from "./grass_ring_compute_resources.js";
