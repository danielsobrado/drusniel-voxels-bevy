import shaderSource from "./shaders/prop_ring.compute.wgsl?raw";
import type { CustomPropsSettings } from "../props/prop_types.js";
import { shouldRequestGpuReadback } from "../diagnostics/gpu_readback_policy.js";
import { reportGpuCpuFallback } from "./gpu_cpu_fallback_log.js";

const INDIRECT_ARGS_PER_GROUP = 5;
const PARAM_BYTES = 16 * 9;
const READBACK_INTERVAL_FRAMES = 30;

export const PROP_GPU_RING_STORAGE_BINDINGS = 9;

export interface PropGpuRingSourceData {
  sourceA: Float32Array;
  sourceB: Float32Array;
  assetMeta: Float32Array;
  assetLods: Float32Array;
  groupMeta: Uint32Array;
  sourceCount: number;
  groupCount: number;
}

export interface PropGpuRingOutputBuffers { instanceA: GPUBuffer; instanceB: GPUBuffer; indirectArgs: GPUBuffer }
export interface PropGpuRingDispatchParams { centerX: number; centerY: number; centerZ: number; ringRadius: number; cameraX: number; cameraY: number; cameraZ: number; maxInstancesPerGroup: number; frustumPlanes: ArrayLike<number> }
export interface PropGpuRingStats { status: "initializing" | "ready" | "running" | "failed" | "disabled"; reason?: string; candidateCount: number; visibleCount: number; groupCounts: number[]; overflowed: boolean; submitMs: number | null; readbackMs: number | null }

interface ReadbackSlot { buffer: GPUBuffer; busy: boolean; destroyAfterMap: boolean; cpu: Uint32Array }
type PipelineName = "clear_counters" | "cull_props" | "build_indirect_args";

export function propGpuRingUnsupportedReason(device: GPUDevice): string | null {
  const maxStorageBuffers = device.limits.maxStorageBuffersPerShaderStage;
  if (maxStorageBuffers >= PROP_GPU_RING_STORAGE_BINDINGS) return null;
  return `custom prop GPU ring requires ${PROP_GPU_RING_STORAGE_BINDINGS} storage buffers per shader stage; device limit is ${maxStorageBuffers}`;
}

export function propGpuRingGroupCapacity(settings: CustomPropsSettings, groupCount: number): number {
  return Math.max(1, Math.floor(settings.gpu.maxVisible / Math.max(1, groupCount)));
}

export class PropGpuRingCompute {
  private readonly paramBuffer: GPUBuffer;
  private readonly counterBuffer: GPUBuffer;
  private readonly sourceABuffer: GPUBuffer;
  private readonly sourceBBuffer: GPUBuffer;
  private readonly assetMetaBuffer: GPUBuffer;
  private readonly assetLodsBuffer: GPUBuffer;
  private readonly groupMetaBuffer: GPUBuffer;
  private readonly counterReadbacks: ReadbackSlot[];
  private readonly bindGroup: GPUBindGroup;
  private readonly paramScratch = new ArrayBuffer(PARAM_BYTES);
  private readonly pipelines: Record<PipelineName, GPUComputePipeline>;
  private readonly groupCount: number;
  private readonly sourceCount: number;
  private readonly groupCounts: number[];
  private runningReadbacks = 0;
  private failedReason: string | null = null;
  private submitMs: number | null = null;
  private readbackMs: number | null = null;
  private overflowed = false;
  private visibleCount = 0;
  private generation = 0;
  private frame = 0;

  private constructor(
    private readonly device: GPUDevice,
    layout: GPUBindGroupLayout,
    pipelines: Record<PipelineName, GPUComputePipeline>,
    source: PropGpuRingSourceData,
    outputBuffers: PropGpuRingOutputBuffers,
    private readonly settings: CustomPropsSettings,
  ) {
    this.pipelines = pipelines;
    this.groupCount = Math.max(1, source.groupCount);
    this.sourceCount = Math.max(0, source.sourceCount);
    this.groupCounts = new Array<number>(this.groupCount).fill(0);
    this.paramBuffer = device.createBuffer({ label: "prop ring params", size: PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.counterBuffer = device.createBuffer({ label: "prop ring counters", size: this.groupCount * Uint32Array.BYTES_PER_ELEMENT, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.sourceABuffer = this.createStaticBuffer("prop ring source a", source.sourceA, GPUBufferUsage.STORAGE);
    this.sourceBBuffer = this.createStaticBuffer("prop ring source b", source.sourceB, GPUBufferUsage.STORAGE);
    this.assetMetaBuffer = this.createStaticBuffer("prop ring asset meta", source.assetMeta, GPUBufferUsage.STORAGE);
    this.assetLodsBuffer = this.createStaticBuffer("prop ring asset lods", source.assetLods, GPUBufferUsage.STORAGE);
    this.groupMetaBuffer = this.createStaticBuffer("prop ring group meta", source.groupMeta, GPUBufferUsage.STORAGE);
    this.counterReadbacks = Array.from({ length: 2 }, (_, index) => ({
      buffer: device.createBuffer({ label: `prop ring counter readback ${index}`, size: this.groupCount * Uint32Array.BYTES_PER_ELEMENT, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
      busy: false,
      destroyAfterMap: false,
      cpu: new Uint32Array(this.groupCount),
    }));
    this.bindGroup = device.createBindGroup({
      label: "prop ring bind group",
      layout,
      entries: [
        { binding: 0, resource: { buffer: this.paramBuffer } },
        { binding: 1, resource: { buffer: this.counterBuffer } },
        { binding: 2, resource: { buffer: outputBuffers.indirectArgs } },
        { binding: 3, resource: { buffer: outputBuffers.instanceA } },
        { binding: 4, resource: { buffer: outputBuffers.instanceB } },
        { binding: 5, resource: { buffer: this.sourceABuffer } },
        { binding: 6, resource: { buffer: this.sourceBBuffer } },
        { binding: 7, resource: { buffer: this.assetMetaBuffer } },
        { binding: 8, resource: { buffer: this.assetLodsBuffer } },
        { binding: 9, resource: { buffer: this.groupMetaBuffer } },
      ],
    });
  }

  static async create(device: GPUDevice, source: PropGpuRingSourceData, outputBuffers: PropGpuRingOutputBuffers, settings: CustomPropsSettings): Promise<PropGpuRingCompute> {
    try {
      const code = shaderSource.replaceAll("WORKGROUP_SIZE", String(settings.gpu.workgroupSize));
      const module = device.createShaderModule({ label: "prop ring compute shader", code });
      const storage = (binding: number, type: GPUBufferBindingType = "storage"): GPUBindGroupLayoutEntry => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type } });
      const layout = device.createBindGroupLayout({
        label: "prop ring compute layout",
        entries: [
          { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
          storage(1), storage(2), storage(3), storage(4), storage(5, "read-only-storage"), storage(6, "read-only-storage"), storage(7, "read-only-storage"), storage(8, "read-only-storage"), storage(9, "read-only-storage"),
        ],
      });
      const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
      const makePipeline = (entryPoint: PipelineName) => device.createComputePipelineAsync({ label: `prop ring ${entryPoint}`, layout: pipelineLayout, compute: { module, entryPoint } });
      const [clearCounters, cullProps, buildIndirectArgs] = await Promise.all([makePipeline("clear_counters"), makePipeline("cull_props"), makePipeline("build_indirect_args")]);
      return new PropGpuRingCompute(device, layout, { clear_counters: clearCounters, cull_props: cullProps, build_indirect_args: buildIndirectArgs }, source, outputBuffers, settings);
    } catch (error) {
      if (settings.gpu.fallbackToCpu) reportGpuCpuFallback("props-gpu-ring", error);
      throw error;
    }
  }

  dispatch(params: PropGpuRingDispatchParams): boolean {
    if (this.failedReason) return false;
    try {
      this.packParams(params);
      this.device.queue.writeBuffer(this.paramBuffer, 0, this.paramScratch);
      const frame = this.frame++;
      const requestReadback = shouldRequestGpuReadback({ kind: "prop_gpu_counts", frame, intervalFrames: READBACK_INTERVAL_FRAMES, requested: this.settings.gpu.debugShowGpuCounts });
      const readbackSlot = requestReadback ? this.counterReadbacks.find((candidate) => !candidate.busy) ?? null : null;
      const encoder = this.device.createCommandEncoder({ label: "prop ring compute encoder" });
      this.dispatchPipeline(encoder, this.pipelines.clear_counters, Math.ceil((this.groupCount * INDIRECT_ARGS_PER_GROUP) / this.settings.gpu.workgroupSize));
      this.dispatchPipeline(encoder, this.pipelines.cull_props, Math.ceil(this.sourceCount / this.settings.gpu.workgroupSize));
      this.dispatchPipeline(encoder, this.pipelines.build_indirect_args, Math.ceil(this.groupCount / this.settings.gpu.workgroupSize));
      if (readbackSlot) encoder.copyBufferToBuffer(this.counterBuffer, 0, readbackSlot.buffer, 0, this.groupCount * Uint32Array.BYTES_PER_ELEMENT);
      const submittedGeneration = this.generation;
      const submitStart = performance.now();
      this.device.queue.submit([encoder.finish()]);
      this.submitMs = performance.now() - submitStart;
      if (readbackSlot) {
        readbackSlot.busy = true;
        readbackSlot.destroyAfterMap = false;
        this.runningReadbacks++;
        this.readback(readbackSlot, submittedGeneration, params.maxInstancesPerGroup);
      }
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    }
  }

  stats(enabled: boolean): PropGpuRingStats {
    return {
      status: !enabled ? "disabled" : this.failedReason ? "failed" : this.runningReadbacks > 0 ? "running" : "ready",
      reason: this.failedReason ?? undefined,
      candidateCount: this.sourceCount,
      visibleCount: this.visibleCount,
      groupCounts: [...this.groupCounts],
      overflowed: this.overflowed,
      submitMs: this.submitMs,
      readbackMs: this.readbackMs,
    };
  }

  destroy(): void {
    this.generation++;
    this.runningReadbacks = 0;
    this.paramBuffer.destroy();
    this.counterBuffer.destroy();
    this.sourceABuffer.destroy();
    this.sourceBBuffer.destroy();
    this.assetMetaBuffer.destroy();
    this.assetLodsBuffer.destroy();
    this.groupMetaBuffer.destroy();
    for (const slot of this.counterReadbacks) {
      if (slot.busy) slot.destroyAfterMap = true;
      else slot.buffer.destroy();
    }
  }

  private packParams(params: PropGpuRingDispatchParams): void {
    const f32 = new Float32Array(this.paramScratch);
    f32.fill(0);
    f32[0] = params.centerX;
    f32[1] = params.centerZ;
    f32[2] = params.centerY;
    f32[3] = params.ringRadius;
    f32[4] = params.cameraX;
    f32[5] = params.cameraY;
    f32[6] = params.cameraZ;
    f32[7] = Math.max(1, Math.floor(params.maxInstancesPerGroup));
    f32[10] = this.groupCount;
    f32[11] = this.sourceCount;
    for (let i = 0; i < Math.min(24, params.frustumPlanes.length); i++) f32[12 + i] = params.frustumPlanes[i] ?? 0;
  }

  private createStaticBuffer(label: string, data: Float32Array | Uint32Array, usage: GPUBufferUsageFlags): GPUBuffer {
    const byteLength = Math.max(4, data.byteLength);
    const buffer = this.device.createBuffer({ label, size: align4(byteLength), usage: usage | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(buffer, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
    return buffer;
  }

  private dispatchPipeline(encoder: GPUCommandEncoder, pipeline: GPUComputePipeline, workgroups: number): void {
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.max(1, workgroups));
    pass.end();
  }

  private readback(slot: ReadbackSlot, submittedGeneration: number, maxInstancesPerGroup: number): void {
    const start = performance.now();
    void slot.buffer.mapAsync(GPUMapMode.READ).then(() => {
      if (submittedGeneration !== this.generation) {
        slot.busy = false; slot.destroyAfterMap = false; this.runningReadbacks = Math.max(0, this.runningReadbacks - 1); slot.buffer.unmap(); slot.buffer.destroy(); return;
      }
      slot.cpu.set(new Uint32Array(slot.buffer.getMappedRange(0, this.groupCount * Uint32Array.BYTES_PER_ELEMENT)));
      slot.buffer.unmap();
      slot.busy = false;
      this.runningReadbacks = Math.max(0, this.runningReadbacks - 1);
      this.readbackMs = performance.now() - start;
      this.visibleCount = 0;
      this.overflowed = false;
      for (let i = 0; i < this.groupCount; i++) {
        const raw = slot.cpu[i] ?? 0;
        const clamped = Math.min(raw, maxInstancesPerGroup);
        this.groupCounts[i] = clamped;
        this.visibleCount += clamped;
        if (raw > maxInstancesPerGroup) this.overflowed = true;
      }
      if (slot.destroyAfterMap) { slot.destroyAfterMap = false; slot.buffer.destroy(); }
    }).catch((error) => {
      if (submittedGeneration !== this.generation) {
        slot.busy = false; slot.destroyAfterMap = false; this.runningReadbacks = Math.max(0, this.runningReadbacks - 1); slot.buffer.destroy(); return;
      }
      slot.busy = false;
      this.runningReadbacks = Math.max(0, this.runningReadbacks - 1);
      if (slot.destroyAfterMap) { slot.destroyAfterMap = false; slot.buffer.destroy(); return; }
      this.fail(error);
    });
  }

  private fail(error: unknown): void {
    this.failedReason = error instanceof Error ? error.message : String(error);
    if (this.settings.gpu.fallbackToCpu) reportGpuCpuFallback("props-gpu-ring", error);
  }
}

function align4(value: number): number {
  return Math.max(4, Math.ceil(value / 4) * 4);
}
