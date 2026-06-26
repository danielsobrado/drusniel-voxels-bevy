import { DIG_EDIT_BYTES, packDigEdits, packFieldParams } from "./gpu_mesh_buffers.js";
import type { ResolvedDigEdit } from "./terrain_field_core.js";
import { composeGrassRingShader } from "./wgsl_modules.js";
import { DEFAULT_GRASS_SETTINGS, type GrassRingSettings, type GrassSettings } from "../grass/grass_config.js";
import { grassHeightDensityVector, grassMaterialDensityVector } from "../grass/grass_material_bias.js";

const WORKGROUP_SIZE = 64;
const PARAM_BYTES = 16 * 17;
const COUNTER_BYTES = 4 * Uint32Array.BYTES_PER_ELEMENT;
const INDIRECT_ARGS_PER_TIER = 5;
const TIER_COUNT = 4;
const INDIRECT_BYTES = TIER_COUNT * INDIRECT_ARGS_PER_TIER * Uint32Array.BYTES_PER_ELEMENT;
const READBACK_SLOTS = 2;
const READBACK_INTERVAL_FRAMES = 90;
const DEFAULT_MATERIAL_DENSITY: [number, number, number, number] = [1, 1, 1, 1];
const DEFAULT_HEIGHT_DENSITY: [number, number, number, number, number, number] = [14, 34, 8, 1, 1, 1];
export const GRASS_GPU_RING_MAX_SAFE_GRID = 384;

export const GRASS_GPU_RING_GRID = DEFAULT_GRASS_SETTINGS.ring.grid;
export const GRASS_GPU_RING_CELL = DEFAULT_GRASS_SETTINGS.ring.cell;
export const GRASS_GPU_RING_SLOT_COUNT = GRASS_GPU_RING_GRID * GRASS_GPU_RING_GRID;
export const GRASS_GPU_RING_STORAGE_BINDINGS = 7;

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
  return {
    start,
    end: start + Math.max(0, Math.floor(maxInstancesPerTier)),
    firstInstance: start,
  };
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
    for (let i = 0; i < Math.min(24, params.frustumPlanes.length); i++) {
      f32[44 + i] = params.frustumPlanes[i] ?? 0;
    }
  }
  return scratch;
}

export class GrassGpuRingCompute {
  private readonly paramBuffer: GPUBuffer;
  private readonly counterBuffer: GPUBuffer;
  private readonly counterReadbacks: ReadbackSlot[];
  private readonly indirectArgs: GPUBuffer;
  private readonly outputBuffers: GrassGpuRingOutputBuffers | null;
  private readonly fieldParams: GPUBuffer;
  private digEdits: GPUBuffer;
  private readonly bindGroup: GPUBindGroup;
  private readonly hydroTexture: GPUTexture;
  private readonly paramScratch = new ArrayBuffer(PARAM_BYTES);
  private readonly pipelines: Record<PipelineName, GPUComputePipeline>;
  private counts: GrassGpuRingCounts = { near: 0, mid: 0, far: 0, super: 0 };
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
    outputBuffers: GrassGpuRingOutputBuffers | null,
    private readonly ring: GrassRingSettings,
    hydroData: GrassHydrologyData | null,
  ) {
    this.pipelines = pipelines;
    this.outputBuffers = outputBuffers;
    this.paramBuffer = device.createBuffer({
      label: "grass ring params",
      size: PARAM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.counterBuffer = device.createBuffer({
      label: "grass ring counters",
      size: COUNTER_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this.indirectArgs = outputBuffers?.indirectArgs ?? device.createBuffer({
      label: "grass ring indirect args",
      size: INDIRECT_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC,
    });
    this.fieldParams = device.createBuffer({
      label: "grass ring field params",
      size: 4 * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.digEdits = device.createBuffer({
      label: "grass ring dig edits",
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
        label: `grass ring counter readback ${index}`,
        size: COUNTER_BYTES,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }),
      busy: false,
      destroyAfterMap: false,
      cpu: new Uint32Array(TIER_COUNT),
    }));
    this.hydroTexture = this.createHydrologyTexture(hydroData);
    const hydroSampler = device.createSampler({
      label: "grass ring hydro sampler",
      magFilter: "nearest",
      minFilter: "nearest",
    });
    this.bindGroup = device.createBindGroup({
      label: "grass ring bind group",
      layout,
      entries: [
        { binding: 0, resource: { buffer: this.paramBuffer } },
        { binding: 1, resource: { buffer: this.counterBuffer } },
        { binding: 2, resource: { buffer: this.indirectArgs } },
        ...this.outputBindGroupEntries(),
        { binding: 7, resource: { buffer: this.digEdits } },
        { binding: 8, resource: { buffer: this.fieldParams } },
        { binding: 9, resource: this.hydroTexture.createView() },
        { binding: 10, resource: hydroSampler },
      ],
    });
  }

  static async create(
    device: GPUDevice,
    edits: readonly ResolvedDigEdit[],
    outputBuffers: GrassGpuRingOutputBuffers | null = null,
    ring: GrassRingSettings = DEFAULT_GRASS_SETTINGS.ring,
    hydroData: GrassHydrologyData | null = null,
  ): Promise<GrassGpuRingCompute> {
    const module = device.createShaderModule({
      label: "grass ring compute shader",
      code: composeGrassRingShader(),
    });
    const storage = (binding: number, type: GPUBufferBindingType = "storage"): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type },
    });
    const layout = device.createBindGroupLayout({
      label: "grass ring compute layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        storage(1),
        storage(2),
        storage(3),
        storage(4),
        storage(5),
        storage(6),
        storage(7, "read-only-storage"),
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 9, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "float" } },
        { binding: 10, visibility: GPUShaderStage.COMPUTE, sampler: {} },
      ],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const makePipeline = (entryPoint: PipelineName) =>
      device.createComputePipelineAsync({
        label: `grass ring ${entryPoint}`,
        layout: pipelineLayout,
        compute: { module, entryPoint },
      });
    const [clearCounters, cull, buildIndirectArgs] = await Promise.all([
      makePipeline("clear_counters"),
      makePipeline("grass_cull"),
      makePipeline("build_indirect_args"),
    ]);
    return new GrassGpuRingCompute(device, layout, {
      clear_counters: clearCounters,
      grass_cull: cull,
      build_indirect_args: buildIndirectArgs,
    }, edits, outputBuffers, { ...ring }, hydroData);
  }

  dispatch(params: GrassGpuRingDispatchParams, indexCounts: GrassGpuRingIndexCounts): boolean {
    if (this.failedReason) return false;

    const requestReadback = this.frame++ % READBACK_INTERVAL_FRAMES === 0;
    const readbackSlot = requestReadback
      ? this.counterReadbacks.find((candidate) => !candidate.busy) ?? null
      : null;
    if (requestReadback && !readbackSlot) this.skippedDispatches++;

    packGrassGpuRingParams(params, indexCounts, this.ring, this.paramScratch);
    this.device.queue.writeBuffer(this.paramBuffer, 0, this.paramScratch);

    const encoder = this.device.createCommandEncoder({ label: "grass ring compute encoder" });
    this.dispatchPipeline(encoder, this.pipelines.clear_counters, 1);
    const slotWorkgroups = Math.ceil(grassGpuRingSlotCount(this.ring) / WORKGROUP_SIZE);
    this.dispatchPipeline(encoder, this.pipelines.grass_cull, slotWorkgroups);
    this.dispatchPipeline(encoder, this.pipelines.build_indirect_args, 1);
    if (readbackSlot) {
      encoder.copyBufferToBuffer(this.counterBuffer, 0, readbackSlot.buffer, 0, COUNTER_BYTES);
    }

    const submittedGeneration = this.generation;
    const submitStart = performance.now();
    if (readbackSlot) {
      readbackSlot.busy = true;
      readbackSlot.destroyAfterMap = false;
      this.runningReadbacks++;
    }
    this.device.queue.submit([encoder.finish()]);
    this.submitMs = performance.now() - submitStart;

    if (readbackSlot) {
      const slot = readbackSlot;
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
        const cap = Math.max(0, Math.floor(params.maxInstancesPerTier));
        this.counts = {
          near: Math.min(slot.cpu[0] ?? 0, cap),
          mid: Math.min(slot.cpu[1] ?? 0, cap),
          far: Math.min(slot.cpu[2] ?? 0, cap),
          super: Math.min(slot.cpu[3] ?? 0, cap),
        };
        if (slot.destroyAfterMap) {
          slot.destroyAfterMap = false;
          slot.buffer.destroy();
        }
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
        if (slot.destroyAfterMap) {
          slot.destroyAfterMap = false;
          slot.buffer.destroy();
          return;
        }
        this.failedReason = error instanceof Error ? error.message : String(error);
      });
    }
    return true;
  }

  stats(enabled: boolean): GrassGpuRingStats {
    const accepted = this.counts.near + this.counts.mid + this.counts.far + this.counts.super;
    const slotCount = grassGpuRingSlotCount(this.ring);
    return {
      status: !enabled
        ? "disabled"
        : this.failedReason
          ? "failed"
          : this.runningReadbacks > 0 ? "running" : "ready",
      reason: this.failedReason ?? undefined,
      candidateCount: slotCount,
      generatedCandidates: slotCount,
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
    this.digEdits.destroy();
    this.fieldParams.destroy();
    this.hydroTexture.destroy();
    if (!this.outputBuffers) this.indirectArgs.destroy();
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

  private outputBindGroupEntries(): GPUBindGroupEntry[] {
    const fallback = this.outputBuffers ?? this.createFallbackOutputBuffers();
    return [
      { binding: 3, resource: { buffer: fallback.near.offset } },
      { binding: 4, resource: { buffer: fallback.near.packed0 } },
      { binding: 5, resource: { buffer: fallback.near.packed1 } },
      { binding: 6, resource: { buffer: fallback.near.terrainNormal } },
    ];
  }

  private createFallbackOutputBuffers(): GrassGpuRingOutputBuffers {
    const bytes = Math.max(16, grassGpuRingSlotCount(this.ring) * TIER_COUNT * 4 * Float32Array.BYTES_PER_ELEMENT);
    const shared: GrassGpuTierOutputBuffers = {
      offset: this.device.createBuffer({ label: "grass ring fallback offset", size: bytes, usage: GPUBufferUsage.STORAGE }),
      packed0: this.device.createBuffer({ label: "grass ring fallback packed0", size: bytes, usage: GPUBufferUsage.STORAGE }),
      packed1: this.device.createBuffer({ label: "grass ring fallback packed1", size: bytes, usage: GPUBufferUsage.STORAGE }),
      terrainNormal: this.device.createBuffer({ label: "grass ring fallback normal", size: bytes, usage: GPUBufferUsage.STORAGE }),
    };
    return {
      near: shared,
      mid: shared,
      far: shared,
      super: shared,
      indirectArgs: this.indirectArgs,
    };
  }

  private createHydrologyTexture(hydroData: GrassHydrologyData | null): GPUTexture {
    if (hydroData && hydroData.data.length > 0) {
      const texture = this.device.createTexture({
        label: "grass ring hydro texture",
        size: { width: hydroData.res, height: hydroData.res },
        format: "rgba32float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      const bytes = new Uint8Array(hydroData.data.byteLength);
      bytes.set(new Uint8Array(hydroData.data.buffer, hydroData.data.byteOffset, hydroData.data.byteLength));
      this.device.queue.writeTexture(
        { texture },
        bytes,
        { bytesPerRow: hydroData.res * 16 },
        { width: hydroData.res, height: hydroData.res },
      );
      return texture;
    }
    return this.device.createTexture({
      label: "grass ring fallback hydro texture",
      size: { width: 1, height: 1 },
      format: "rgba32float",
      usage: GPUTextureUsage.TEXTURE_BINDING,
    });
  }
}
