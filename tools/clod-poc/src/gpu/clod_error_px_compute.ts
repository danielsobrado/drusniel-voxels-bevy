import type { SelectionParams } from "../clod/selection.js";
import type { ClodPageNode } from "../types.js";
import type { WebGpuUnavailable } from "./webgpu_device.js";
import type { WebGpuReadbackMode } from "../core/webgpu_readback_mode.js";
import type { ClodErrorMap, ClodErrorPxStats, DispatchOptions, ReadbackSlot } from "./clod_error_px_compute_types.js";
import { PARAM_FLOATS, READBACK_SLOTS, WORKGROUP_SIZE, cloneParams, writeFloat32Buffer } from "./clod_error_px_compute_types.js";
import { createClodErrorPxPipeline } from "./clod_error_px_compute_pipeline.js";
import {
  buildNodePatches,
  computeBufferSizes,
  createClodBindGroup,
  createClodNodeBuffer,
  createClodOutputBuffer,
  createClodParamBuffer,
  createClodReadbackSlots,
  destroyReadbackSlots,
  fillClodParams,
  findClodReadbackSlot,
  packNodes,
  writeNodePatchesContiguous,
} from "./clod_error_px_compute_helpers.js";

export type {
  ClodErrorComputeParams,
  ClodErrorMap,
  ClodErrorPxStats,
  DispatchOptions,
} from "./clod_error_px_compute_types.js";

export interface ClodErrorPxComputeCreateResult {
  compute: ClodErrorPxCompute | null;
  unavailable: WebGpuUnavailable | null;
}

export class ClodErrorPxCompute {
  private nodeBuffer: GPUBuffer;
  private outputBuffer: GPUBuffer;
  private paramBuffer: GPUBuffer;
  private bindGroup: GPUBindGroup;
  private readonly readbacks: ReadbackSlot[];
  private readonly paramScratch = new Float32Array(PARAM_FLOATS);
  private latest: ClodErrorMap | null = null;
  private generation = 0;
  private running = 0;
  private failedReason: string | null = null;
  private submitMs: number | null = null;
  private readbackMs: number | null = null;
  private skippedDispatches = 0;
  private parity: ClodErrorPxStats["parity"] = "unchecked";
  private parityMaxDelta: number | null = null;
  private version = 0;
  private nodeIndexById = new Map<string, number>();
  private nodeCount = 0;
  private readbackMode: WebGpuReadbackMode = "off";
  private dispatchOnlyFrames = 0;
  private readbackFrames = 0;

  private constructor(
    private readonly device: GPUDevice,
    private readonly pipeline: GPUComputePipeline,
    nodes: readonly ClodPageNode[],
  ) {
    const { data, nodeIndexById, nodeCount } = packNodes(nodes);
    this.nodeIndexById = nodeIndexById;
    this.nodeCount = nodeCount;
    const sizes = computeBufferSizes(nodeCount, data.byteLength);
    this.nodeBuffer = createClodNodeBuffer(device, sizes.nodeBytes, data);
    this.outputBuffer = createClodOutputBuffer(device, sizes.outputBytes);
    this.paramBuffer = createClodParamBuffer(device, PARAM_FLOATS * Float32Array.BYTES_PER_ELEMENT);
    this.readbacks = createClodReadbackSlots(device, READBACK_SLOTS, sizes.outputBytes);
    this.bindGroup = createClodBindGroup(device, pipeline, this.nodeBuffer, this.paramBuffer, this.outputBuffer);
  }

  setReadbackMode(mode: WebGpuReadbackMode): void { this.readbackMode = mode; }

  currentVersion(): number { return this.version; }

  static async create(
    nodes: readonly ClodPageNode[],
    sharedDevice?: GPUDevice,
  ): Promise<ClodErrorPxComputeCreateResult> {
    const result = await createClodErrorPxPipeline(sharedDevice);
    if (!result.device) return { compute: null, unavailable: result.unavailable };
    return { compute: new ClodErrorPxCompute(result.device, result.pipeline, nodes), unavailable: null };
  }

  setNodes(nodes: readonly ClodPageNode[]): void {
    const { data, nodeIndexById, nodeCount } = packNodes(nodes);
    this.nodeIndexById = nodeIndexById;
    this.nodeCount = nodeCount;
    this.version++;
    this.generation++;
    this.running = 0;
    this.latest = null;

    this.nodeBuffer.destroy();
    this.outputBuffer.destroy();
    destroyReadbackSlots(this.readbacks);

    const sizes = computeBufferSizes(nodeCount, data.byteLength);
    this.nodeBuffer = createClodNodeBuffer(this.device, sizes.nodeBytes, data);
    this.outputBuffer = createClodOutputBuffer(this.device, sizes.outputBytes);
    this.readbacks.splice(0, this.readbacks.length, ...createClodReadbackSlots(this.device, READBACK_SLOTS, sizes.outputBytes));
    this.bindGroup = createClodBindGroup(this.device, this.pipeline, this.nodeBuffer, this.paramBuffer, this.outputBuffer);
  }

  patchNodes(nodes: readonly ClodPageNode[]): void {
    const updates = buildNodePatches(nodes, this.nodeIndexById);
    if (updates.length === 0) return;
    this.version++;
    this.latest = null;
    writeNodePatchesContiguous(this.device, this.nodeBuffer, updates);
  }

  dispatch(selectionParams: SelectionParams, frameId: number, options?: DispatchOptions): boolean {
    if (this.failedReason || this.nodeCount === 0) return false;
    const readback = options?.readback ?? false;

    const params = cloneParams({
      camPos: selectionParams.camPos,
      viewportH: selectionParams.viewportH,
      fovY: selectionParams.fovY,
    });

    fillClodParams(this.paramScratch, params, this.nodeCount);
    writeFloat32Buffer(this.device, this.paramBuffer, 0, this.paramScratch);

    const encoder = this.device.createCommandEncoder({ label: "clod error px encoder" });
    const pass = encoder.beginComputePass({ label: "clod error px pass" });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.nodeCount / WORKGROUP_SIZE));
    pass.end();

    const slot = readback ? findClodReadbackSlot(this.readbacks) : undefined;
    if (readback && !slot) { this.skippedDispatches++; return false; }
    if (slot) {
      encoder.copyBufferToBuffer(this.outputBuffer, 0, slot.buffer, 0, this.nodeCount * Float32Array.BYTES_PER_ELEMENT);
    }

    const submittedVersion = this.version;
    const submittedGeneration = this.generation;
    const submittedParams = cloneParams(params);
    const submitStart = performance.now();
    const valueBytes = this.nodeCount * Float32Array.BYTES_PER_ELEMENT;
    if (slot) slot.busy = true;
    this.running++;
    this.device.queue.submit([encoder.finish()]);
    this.submitMs = performance.now() - submitStart;

    if (!readback || !slot) { this.dispatchOnlyFrames++; return true; }

    this.readbackFrames++;
    const readbackStart = performance.now();
    const localSlot = slot;
    void localSlot.buffer.mapAsync(GPUMapMode.READ).then(() => {
      if (submittedGeneration !== this.generation) { localSlot.buffer.destroy(); return; }
      const mapped = localSlot.buffer.getMappedRange(0, valueBytes);
      localSlot.cpu.set(new Float32Array(mapped));
      localSlot.buffer.unmap();
      localSlot.busy = false;
      this.running = Math.max(0, this.running - 1);
      this.readbackMs = performance.now() - readbackStart;
      this.latest = { values: localSlot.cpu, version: submittedVersion, frameId, completedAt: performance.now(), params: submittedParams };
    }).catch((error) => {
      if (submittedGeneration !== this.generation) return;
      localSlot.busy = false;
      this.running = Math.max(0, this.running - 1);
      this.failedReason = error instanceof Error ? error.message : String(error);
    });
    return true;
  }

  latestFor(frameId: number, maxAgeFrames: number): ClodErrorMap | null {
    if (this.failedReason || !this.latest || this.latest.version !== this.version) return null;
    if (frameId - this.latest.frameId > maxAgeFrames) return null;
    return this.latest;
  }

  errorLookup(map: ClodErrorMap): (node: ClodPageNode) => number | undefined {
    return (node) => {
      const index = this.nodeIndexById.get(node.id);
      if (index === undefined) return undefined;
      const value = map.values[index];
      return Number.isFinite(value) ? value : undefined;
    };
  }

  valueFor(node: ClodPageNode, map: ClodErrorMap): number | undefined {
    const index = this.nodeIndexById.get(node.id);
    if (index === undefined) return undefined;
    const value = map.values[index];
    return Number.isFinite(value) ? value : undefined;
  }

  markParityOk(maxDelta: number): void {
    this.parity = "ok";
    this.parityMaxDelta = maxDelta;
  }

  markParityFailed(reason: string, maxDelta: number): void {
    this.parity = "failed";
    this.parityMaxDelta = maxDelta;
    this.failedReason = reason;
  }

  markParityDisabled(): void { this.parity = "disabled"; }

  stats(frameId: number, enabled: boolean): ClodErrorPxStats {
    const latestAgeFrames = this.latest ? frameId - this.latest.frameId : null;
    return {
      enabled, available: !this.failedReason,
      status: !enabled ? "disabled" : this.failedReason ? "failed" : this.running > 0 ? "running" : this.latest ? "ready" : "idle",
      reason: this.failedReason ?? undefined,
      nodeCount: this.nodeCount, version: this.version, latestAgeFrames,
      submitMs: this.submitMs, readbackMs: this.readbackMs,
      skippedDispatches: this.skippedDispatches,
      parity: this.parity, parityMaxDelta: this.parityMaxDelta,
      readbackMode: this.readbackMode,
      dispatchOnlyFrames: this.dispatchOnlyFrames, readbackFrames: this.readbackFrames,
    };
  }

  destroy(): void {
    this.generation++;
    this.running = 0;
    this.nodeBuffer.destroy();
    this.outputBuffer.destroy();
    this.paramBuffer.destroy();
    destroyReadbackSlots(this.readbacks);
  }
}
