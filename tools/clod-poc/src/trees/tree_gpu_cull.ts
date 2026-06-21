import treeCullShader from "../gpu/shaders/tree_cull.compute.wgsl?raw";
import type { TreeSettings } from "./tree_config.js";
import {
  ensureTreeGpuBuffers,
  type TreeGpuBuffers,
} from "./tree_gpu_buffers.js";
import {
  packTreeGpuCullParams,
  TREE_GPU_CANDIDATE_BYTES,
  TREE_GPU_CULL_PARAM_BYTES,
  TREE_GPU_VISIBLE_BYTES,
  type TreeGpuCullParams,
  type TreeGpuVisibleRecord,
} from "./tree_gpu_types.js";
import { unpackTreeGpuVisibleRecords } from "./tree_gpu_readback.js";

export interface TreeGpuCullResult {
  supported: boolean;
  usedGpu: boolean;
  visibleCount: number;
  overflowed: boolean;
  status: "disabled" | "unsupported" | "ready" | "fallback-cpu" | "error";
  errorMessage: string | null;
}

export class TreeGpuCullPipeline {
  private settings: TreeSettings;
  private readonly paramScratch = new ArrayBuffer(TREE_GPU_CULL_PARAM_BYTES);
  private buffers: TreeGpuBuffers | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private pipeline: GPUComputePipeline | null = null;
  private layout: GPUBindGroupLayout | null = null;
  private errorMessage: string | null = null;
  private uploadedCandidateCount = 0;
  private visibleCount = 0;
  private overflowed = false;
  private readbackInFlight = false;
  private dispatchMs: number | null = null;
  private readbackMs: number | null = null;

  constructor(private readonly options: {
    device: GPUDevice;
    settings: TreeSettings;
  }) {
    this.settings = options.settings;
    this.initializePipeline();
  }

  updateSettings(settings: TreeSettings): void {
    const workgroupChanged = settings.gpu.workgroupSize !== this.settings.gpu.workgroupSize;
    this.settings = settings;
    if (workgroupChanged) {
      this.pipeline = null;
      this.bindGroup = null;
      this.initializePipeline();
    }
  }

  uploadCandidates(candidates: Float32Array, candidateCount: number): void {
    if (!this.pipeline || this.errorMessage) return;
    const nextCount = Math.max(0, Math.min(Math.floor(candidateCount), this.settings.gpu.maxCandidates));
    this.buffers = ensureTreeGpuBuffers(
      this.options.device,
      this.buffers,
      this.settings,
      nextCount,
      this.settings.gpu.maxVisible,
    );
    this.bindGroup = null;
    this.ensureBindGroup();
    this.uploadedCandidateCount = nextCount;
    if (nextCount <= 0) return;
    const byteLength = nextCount * TREE_GPU_CANDIDATE_BYTES;
    this.options.device.queue.writeBuffer(
      this.buffers.candidateBuffer,
      0,
      candidates.buffer,
      candidates.byteOffset,
      Math.min(byteLength, candidates.byteLength),
    );
  }

  dispatch(params: TreeGpuCullParams): TreeGpuCullResult {
    if (!this.settings.gpu.enabled || !this.settings.gpu.cullEnabled) return this.result("disabled", false);
    if (!this.pipeline || this.errorMessage) return this.result(this.errorMessage ? "error" : "unsupported", false);
    if (!this.buffers || !this.ensureBindGroup()) return this.result("fallback-cpu", false);

    const clampedParams = {
      ...params,
      candidateCount: Math.min(params.candidateCount, this.uploadedCandidateCount, this.buffers.candidateCapacity),
      maxVisible: Math.min(params.maxVisible, this.buffers.visibleCapacity),
    };
    packTreeGpuCullParams(clampedParams, this.paramScratch);
    const zero = new Uint32Array([0]);
    this.options.device.queue.writeBuffer(this.buffers.visibleCountBuffer, 0, zero);
    this.options.device.queue.writeBuffer(this.buffers.paramsBuffer, 0, this.paramScratch);

    const encoder = this.options.device.createCommandEncoder({ label: "tree gpu cull encoder" });
    const pass = encoder.beginComputePass({ label: "tree gpu cull pass" });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.max(1, Math.ceil(clampedParams.candidateCount / this.settings.gpu.workgroupSize)));
    pass.end();
    if (!this.readbackInFlight && this.buffers.readbackVisibleBuffer && this.buffers.readbackCountBuffer) {
      encoder.copyBufferToBuffer(
        this.buffers.visibleCountBuffer,
        0,
        this.buffers.readbackCountBuffer,
        0,
        Uint32Array.BYTES_PER_ELEMENT,
      );
      encoder.copyBufferToBuffer(
        this.buffers.visibleBuffer,
        0,
        this.buffers.readbackVisibleBuffer,
        0,
        Math.max(TREE_GPU_VISIBLE_BYTES, this.buffers.visibleCapacity * TREE_GPU_VISIBLE_BYTES),
      );
    }
    const start = performance.now();
    this.options.device.queue.submit([encoder.finish()]);
    this.dispatchMs = performance.now() - start;
    return this.result("ready", true);
  }

  async readbackVisible(): Promise<TreeGpuVisibleRecord[]> {
    if (this.readbackInFlight || !this.buffers?.readbackVisibleBuffer || !this.buffers.readbackCountBuffer) return [];
    this.readbackInFlight = true;
    const start = performance.now();
    try {
      await this.buffers.readbackCountBuffer.mapAsync(GPUMapMode.READ);
      const countData = new Uint32Array(this.buffers.readbackCountBuffer.getMappedRange(0, Uint32Array.BYTES_PER_ELEMENT));
      const rawCount = countData[0] ?? 0;
      this.buffers.readbackCountBuffer.unmap();
      this.visibleCount = Math.min(rawCount, this.buffers.visibleCapacity);
      this.overflowed = rawCount > this.buffers.visibleCapacity;
      if (this.visibleCount <= 0) {
        this.readbackMs = performance.now() - start;
        return [];
      }
      const byteLength = this.visibleCount * TREE_GPU_VISIBLE_BYTES;
      await this.buffers.readbackVisibleBuffer.mapAsync(GPUMapMode.READ);
      const records = unpackTreeGpuVisibleRecords(
        new Uint32Array(this.buffers.readbackVisibleBuffer.getMappedRange(0, byteLength).slice(0)),
        this.visibleCount,
      );
      this.buffers.readbackVisibleBuffer.unmap();
      this.readbackMs = performance.now() - start;
      return records;
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : String(error);
      return [];
    } finally {
      this.readbackInFlight = false;
    }
  }

  getStats(): Pick<TreeGpuCullResult, "status" | "visibleCount" | "overflowed" | "errorMessage"> & {
    dispatchMs: number | null;
    readbackMs: number | null;
  } {
    const status = !this.settings.gpu.enabled
      ? "disabled"
      : this.errorMessage
        ? "error"
        : this.pipeline ? "ready" : "unsupported";
    return {
      status,
      visibleCount: this.visibleCount,
      overflowed: this.overflowed,
      errorMessage: this.errorMessage,
      dispatchMs: this.dispatchMs,
      readbackMs: this.readbackMs,
    };
  }

  dispose(): void {
    this.buffers?.dispose();
    this.buffers = null;
    this.bindGroup = null;
    this.pipeline = null;
  }

  private initializePipeline(): void {
    try {
      const device = this.options.device;
      const storage = (binding: number, type: GPUBufferBindingType = "storage"): GPUBindGroupLayoutEntry => ({
        binding,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type },
      });
      this.layout = device.createBindGroupLayout({
        label: "tree gpu cull layout",
        entries: [
          storage(0, "read-only-storage"),
          storage(1),
          storage(2),
          { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        ],
      });
      const module = device.createShaderModule({
        label: "tree gpu cull shader",
        code: treeCullShader,
      });
      this.pipeline = device.createComputePipeline({
        label: "tree gpu cull pipeline",
        layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
        compute: {
          module,
          entryPoint: "tree_cull",
          constants: { TREE_GPU_WORKGROUP_SIZE: this.settings.gpu.workgroupSize },
        },
      });
      this.errorMessage = null;
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : String(error);
      this.pipeline = null;
    }
  }

  private ensureBindGroup(): GPUBindGroup | null {
    if (this.bindGroup) return this.bindGroup;
    if (!this.layout || !this.buffers) return null;
    this.bindGroup = this.options.device.createBindGroup({
      label: "tree gpu cull bind group",
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: this.buffers.candidateBuffer } },
        { binding: 1, resource: { buffer: this.buffers.visibleBuffer } },
        { binding: 2, resource: { buffer: this.buffers.visibleCountBuffer } },
        { binding: 3, resource: { buffer: this.buffers.paramsBuffer } },
      ],
    });
    return this.bindGroup;
  }

  private result(status: TreeGpuCullResult["status"], usedGpu: boolean): TreeGpuCullResult {
    return {
      supported: !!this.pipeline && !this.errorMessage,
      usedGpu,
      visibleCount: this.visibleCount,
      overflowed: this.overflowed,
      status,
      errorMessage: this.errorMessage,
    };
  }
}
