import shaderSource from "./shaders/grass_ring.compute.wgsl?raw";

const WORKGROUP_SIZE = 64;
const PARAM_BYTES = 16 * 4;
const COUNTER_BYTES = 4 * Uint32Array.BYTES_PER_ELEMENT;
const INDIRECT_ARGS_PER_TIER = 5;
const TIER_COUNT = 4;
const INDIRECT_BYTES = TIER_COUNT * INDIRECT_ARGS_PER_TIER * Uint32Array.BYTES_PER_ELEMENT;
const READBACK_SLOTS = 2;

export const GRASS_GPU_CANDIDATE_FLOATS = 12;
export const GRASS_GPU_RING_STORAGE_BINDINGS = 7;

export function grassGpuRingComputeUnsupportedReason(device: GPUDevice): string | null {
  const maxStorageBuffers = device.limits.maxStorageBuffersPerShaderStage;
  if (maxStorageBuffers >= GRASS_GPU_RING_STORAGE_BINDINGS) return null;
  return `grass ring compute requires ${GRASS_GPU_RING_STORAGE_BINDINGS} storage buffers per shader stage; device limit is ${maxStorageBuffers}`;
}

export interface GrassGpuCandidateBuffer {
  data: Float32Array;
  count: number;
  generatedCandidates: number;
  acceptedCandidates: number;
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
  bands: GrassGpuRingBands;
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

type PipelineName = "clear_counters" | "grass_cull_fine" | "grass_cull_far" | "build_indirect_args";

export class GrassGpuRingCompute {
  private readonly candidateBuffer: GPUBuffer;
  private readonly paramBuffer: GPUBuffer;
  private readonly counterBuffer: GPUBuffer;
  private readonly counterReadbacks: ReadbackSlot[];
  private readonly indirectArgs: GPUBuffer;
  private readonly outputBuffers: GrassGpuRingOutputBuffers | null;
  private readonly bindGroup: GPUBindGroup;
  private readonly paramScratch = new ArrayBuffer(PARAM_BYTES);
  private readonly paramF32 = new Float32Array(this.paramScratch);
  private readonly paramU32 = new Uint32Array(this.paramScratch);
  private readonly pipelines: Record<PipelineName, GPUComputePipeline>;
  private counts: GrassGpuRingCounts = { near: 0, mid: 0, far: 0, super: 0 };
  private running = 0;
  private failedReason: string | null = null;
  private dispatchMs: number | null = null;
  private readbackMs: number | null = null;
  private skippedDispatches = 0;
  private generation = 0;

  private constructor(
    private readonly device: GPUDevice,
    private readonly candidateInfo: GrassGpuCandidateBuffer,
    layout: GPUBindGroupLayout,
    pipelines: Record<PipelineName, GPUComputePipeline>,
    outputBuffers: GrassGpuRingOutputBuffers | null,
  ) {
    this.pipelines = pipelines;
    this.outputBuffers = outputBuffers;
    this.candidateBuffer = device.createBuffer({
      label: "grass ring candidates",
      size: Math.max(Float32Array.BYTES_PER_ELEMENT * GRASS_GPU_CANDIDATE_FLOATS, candidateInfo.data.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
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
        { binding: 0, resource: { buffer: this.candidateBuffer } },
        { binding: 1, resource: { buffer: this.paramBuffer } },
        { binding: 2, resource: { buffer: this.counterBuffer } },
        { binding: 3, resource: { buffer: this.indirectArgs } },
        ...this.outputBindGroupEntries(),
      ],
    });
    device.queue.writeBuffer(
      this.candidateBuffer,
      0,
      candidateInfo.data.buffer as ArrayBuffer,
      candidateInfo.data.byteOffset,
      candidateInfo.data.byteLength,
    );
  }

  static async create(
    device: GPUDevice,
    candidateInfo: GrassGpuCandidateBuffer,
    outputBuffers: GrassGpuRingOutputBuffers | null = null,
  ): Promise<GrassGpuRingCompute> {
    const module = device.createShaderModule({
      label: "grass ring compute shader",
      code: shaderSource,
    });
    const layout = device.createBindGroupLayout({
      label: "grass ring compute layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
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
      cullFine,
      cullFar,
      buildIndirectArgs,
    ] = await Promise.all([
      makePipeline("clear_counters"),
      makePipeline("grass_cull_fine"),
      makePipeline("grass_cull_far"),
      makePipeline("build_indirect_args"),
    ]);
    return new GrassGpuRingCompute(device, candidateInfo, layout, {
      clear_counters: clearCounters,
      grass_cull_fine: cullFine,
      grass_cull_far: cullFar,
      build_indirect_args: buildIndirectArgs,
    }, outputBuffers);
  }

  dispatch(params: GrassGpuRingDispatchParams, indexCounts: GrassGpuRingIndexCounts): boolean {
    if (this.failedReason || this.candidateInfo.count === 0) return false;
    const slot = this.counterReadbacks.find((candidate) => !candidate.busy);
    if (!slot) {
      this.skippedDispatches++;
      return false;
    }

    this.paramF32[0] = params.centerX;
    this.paramF32[1] = params.centerZ;
    this.paramF32[2] = params.bands.radius;
    this.paramF32[3] = 0;
    this.paramF32[4] = params.bands.near;
    this.paramF32[5] = params.bands.mid;
    this.paramF32[6] = params.bands.far;
    this.paramF32[7] = 0;
    this.paramU32[8] = this.candidateInfo.count;
    this.paramU32[9] = indexCounts.near;
    this.paramU32[10] = indexCounts.mid;
    this.paramU32[11] = indexCounts.far;
    this.paramU32[12] = indexCounts.super;
    this.paramU32[13] = this.candidateInfo.count;
    this.paramU32[14] = 0;
    this.paramU32[15] = 0;
    this.device.queue.writeBuffer(this.paramBuffer, 0, this.paramScratch);

    const encoder = this.device.createCommandEncoder({ label: "grass ring compute encoder" });
    this.dispatchPipeline(encoder, this.pipelines.clear_counters, 1);
    const candidateWorkgroups = Math.ceil(this.candidateInfo.count / WORKGROUP_SIZE);
    this.dispatchPipeline(encoder, this.pipelines.grass_cull_fine, candidateWorkgroups);
    this.dispatchPipeline(encoder, this.pipelines.grass_cull_far, candidateWorkgroups);
    this.dispatchPipeline(encoder, this.pipelines.build_indirect_args, 1);
    encoder.copyBufferToBuffer(this.counterBuffer, 0, slot.buffer, 0, COUNTER_BYTES);

    const submittedGeneration = this.generation;
    const submitStart = performance.now();
    slot.busy = true;
    this.running++;
    this.device.queue.submit([encoder.finish()]);
    this.dispatchMs = performance.now() - submitStart;
    const readbackStart = performance.now();
    void slot.buffer.mapAsync(GPUMapMode.READ).then(() => {
      if (submittedGeneration !== this.generation) {
        slot.buffer.destroy();
        return;
      }
      slot.cpu.set(new Uint32Array(slot.buffer.getMappedRange(0, COUNTER_BYTES)));
      slot.buffer.unmap();
      slot.busy = false;
      this.running = Math.max(0, this.running - 1);
      this.readbackMs = performance.now() - readbackStart;
      this.counts = {
        near: slot.cpu[0],
        mid: slot.cpu[1],
        far: slot.cpu[2],
        super: slot.cpu[3],
      };
    }).catch((error) => {
      if (submittedGeneration !== this.generation) return;
      slot.busy = false;
      this.running = Math.max(0, this.running - 1);
      this.failedReason = error instanceof Error ? error.message : String(error);
    });
    return true;
  }

  stats(enabled: boolean): GrassGpuRingStats {
    return {
      status: !enabled
        ? "disabled"
        : this.failedReason
          ? "failed"
          : this.running > 0 ? "running" : "ready",
      reason: this.failedReason ?? undefined,
      candidateCount: this.candidateInfo.count,
      generatedCandidates: this.candidateInfo.generatedCandidates,
      acceptedCandidates: this.candidateInfo.acceptedCandidates,
      counts: { ...this.counts },
      dispatchMs: this.dispatchMs,
      readbackMs: this.readbackMs,
      skippedDispatches: this.skippedDispatches,
    };
  }

  destroy(): void {
    this.generation++;
    this.running = 0;
    this.candidateBuffer.destroy();
    this.paramBuffer.destroy();
    this.counterBuffer.destroy();
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
      { binding: 4, resource: { buffer: fallback.near.offset } },
      { binding: 5, resource: { buffer: fallback.near.packed0 } },
      { binding: 6, resource: { buffer: fallback.near.packed1 } },
      { binding: 7, resource: { buffer: fallback.near.terrainNormal } },
    ];
  }

  private createFallbackOutputBuffers(): GrassGpuRingOutputBuffers {
    const bytes = Math.max(16, this.candidateInfo.count * TIER_COUNT * 4 * Float32Array.BYTES_PER_ELEMENT);
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
