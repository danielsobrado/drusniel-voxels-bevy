import { DIG_EDIT_BYTES, packDigEdits, packFieldParams } from "./gpu_mesh_buffers.js";
import type { ResolvedDigEdit } from "./terrain_field_core.js";
import fieldShader from "./shaders/terrain_field.wgsl?raw";
import shaderSource from "./shaders/grass_ring.compute.wgsl?raw";

const WORKGROUP_SIZE = 64;
const PARAM_BYTES = 16 * 12;
const COUNTER_BYTES = 4 * Uint32Array.BYTES_PER_ELEMENT;
const INDIRECT_ARGS_PER_TIER = 5;
const TIER_COUNT = 4;
const INDIRECT_BYTES = TIER_COUNT * INDIRECT_ARGS_PER_TIER * Uint32Array.BYTES_PER_ELEMENT;
const READBACK_SLOTS = 2;
const READBACK_INTERVAL_FRAMES = 90;

// Toroidal slot grid: GRID² candidate cells, CELL m apart → ±(GRID·CELL/2) m ring. Density polish:
// a denser grid (smaller CELL) gives a lusher near field; survivors widen by 1/√thin to conserve
// coverage. ~245 m ring at ~2 slots/m². Cull is one dispatch over GRID² (cheap on GPU).
export const GRASS_GPU_RING_GRID = 700;
export const GRASS_GPU_RING_CELL = 0.7;
export const GRASS_GPU_RING_SLOT_COUNT = GRASS_GPU_RING_GRID * GRASS_GPU_RING_GRID;
export const GRASS_GPU_RING_STORAGE_BINDINGS = 7;

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
  bladeHeight: number;
  bladeHeightVariation: number;
  slopeMinY: number;
  minHeight: number;
  maxHeight: number;
  maxInstancesPerTier: number;
  seed: number;
  frustumPlanes?: ArrayLike<number>;
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
  status: "initializing" | "idle" | "running" | "ready" | "failed" | "disabled";
  reason?: string;
  candidateCount: number;
  generatedCandidates: number;
  acceptedCandidates: number;
  counts: GrassGpuRingCounts;
  dispatchMs: number | null;
  readbackMs: number | null;
  skippedDispatches: number;
}

interface ReadbackSlot {
  buffer: GPUBuffer;
  busy: boolean;
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

function remapTerrainFieldBindings(source: string): string {
  return source
    .replace(/@group\(0\) @binding\(0\) var<storage, read> digEdits/g, "@group(0) @binding(7) var<storage, read> digEdits")
    .replace(/@group\(0\) @binding\(1\) var<uniform> fieldParams/g, "@group(0) @binding(8) var<uniform> fieldParams");
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
  private readonly paramScratch = new ArrayBuffer(PARAM_BYTES);
  private readonly paramF32 = new Float32Array(this.paramScratch);
  private readonly paramU32 = new Uint32Array(this.paramScratch);
  private readonly pipelines: Record<PipelineName, GPUComputePipeline>;
  private counts: GrassGpuRingCounts = { near: 0, mid: 0, far: 0, super: 0 };
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
    outputBuffers: GrassGpuRingOutputBuffers | null,
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
      cpu: new Uint32Array(TIER_COUNT),
    }));
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
      ],
    });
  }

  static async create(
    device: GPUDevice,
    edits: readonly ResolvedDigEdit[],
    outputBuffers: GrassGpuRingOutputBuffers | null = null,
  ): Promise<GrassGpuRingCompute> {
    const module = device.createShaderModule({
      label: "grass ring compute shader",
      code: `${remapTerrainFieldBindings(fieldShader)}\n${shaderSource}`,
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
      ],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const makePipeline = (entryPoint: PipelineName) =>
      device.createComputePipelineAsync({
        label: `grass ring ${entryPoint}`,
        layout: pipelineLayout,
        compute: { module, entryPoint },
      });
    const [
      clearCounters,
      cull,
      buildIndirectArgs,
    ] = await Promise.all([
      makePipeline("clear_counters"),
      makePipeline("grass_cull"),
      makePipeline("build_indirect_args"),
    ]);
    return new GrassGpuRingCompute(device, layout, {
      clear_counters: clearCounters,
      grass_cull: cull,
      build_indirect_args: buildIndirectArgs,
    }, edits, outputBuffers);
  }

  dispatch(params: GrassGpuRingDispatchParams, indexCounts: GrassGpuRingIndexCounts): boolean {
    if (this.failedReason) return false;

    const requestReadback = this.frame++ % READBACK_INTERVAL_FRAMES === 0;
    const readbackSlot = requestReadback
      ? this.counterReadbacks.find((candidate) => !candidate.busy) ?? null
      : null;
    if (requestReadback && !readbackSlot) this.skippedDispatches++;

    this.paramF32.fill(0);
    this.paramU32.fill(0);
    this.paramF32[0] = params.centerX;
    this.paramF32[1] = params.centerZ;
    this.paramF32[2] = params.bands.radius;
    this.paramF32[3] = params.worldCells;
    this.paramF32[4] = params.bands.near;
    this.paramF32[5] = params.bands.mid;
    this.paramF32[6] = params.bands.far;
    this.paramF32[7] = 12;
    this.paramF32[8] = GRASS_GPU_RING_CELL;
    this.paramF32[9] = params.bladeHeight;
    this.paramF32[10] = params.bladeHeightVariation;
    this.paramF32[11] = params.slopeMinY;
    this.paramF32[12] = params.minHeight;
    this.paramF32[13] = params.maxHeight;
    this.paramU32[16] = indexCounts.near;
    this.paramU32[17] = indexCounts.mid;
    this.paramU32[18] = indexCounts.far;
    this.paramU32[19] = indexCounts.super;
    this.paramU32[20] = Math.max(0, Math.floor(params.maxInstancesPerTier));
    this.paramU32[21] = GRASS_GPU_RING_GRID;
    this.paramU32[22] = params.seed >>> 0;
    if (params.frustumPlanes) {
      for (let i = 0; i < Math.min(24, params.frustumPlanes.length); i++) {
        this.paramF32[24 + i] = params.frustumPlanes[i] ?? 0;
      }
    }
    this.device.queue.writeBuffer(this.paramBuffer, 0, this.paramScratch);

    const encoder = this.device.createCommandEncoder({ label: "grass ring compute encoder" });
    this.dispatchPipeline(encoder, this.pipelines.clear_counters, 1);
    const slotWorkgroups = Math.ceil(GRASS_GPU_RING_SLOT_COUNT / WORKGROUP_SIZE);
    this.dispatchPipeline(encoder, this.pipelines.grass_cull, slotWorkgroups);
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
        const cap = Math.max(0, Math.floor(params.maxInstancesPerTier));
        this.counts = {
          near: Math.min(slot.cpu[0] ?? 0, cap),
          mid: Math.min(slot.cpu[1] ?? 0, cap),
          far: Math.min(slot.cpu[2] ?? 0, cap),
          super: Math.min(slot.cpu[3] ?? 0, cap),
        };
      }).catch((error) => {
        if (submittedGeneration !== this.generation) return;
        slot.busy = false;
        this.runningReadbacks = Math.max(0, this.runningReadbacks - 1);
        this.failedReason = error instanceof Error ? error.message : String(error);
      });
    }
    return true;
  }

  stats(enabled: boolean): GrassGpuRingStats {
    const accepted = this.counts.near + this.counts.mid + this.counts.far + this.counts.super;
    return {
      status: !enabled
        ? "disabled"
        : this.failedReason
          ? "failed"
          : this.runningReadbacks > 0 ? "running" : "ready",
      reason: this.failedReason ?? undefined,
      candidateCount: GRASS_GPU_RING_SLOT_COUNT,
      generatedCandidates: GRASS_GPU_RING_SLOT_COUNT,
      acceptedCandidates: accepted,
      counts: { ...this.counts },
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
    if (!this.outputBuffers) this.indirectArgs.destroy();
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
    const bytes = Math.max(16, GRASS_GPU_RING_SLOT_COUNT * TIER_COUNT * 4 * Float32Array.BYTES_PER_ELEMENT);
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
}
