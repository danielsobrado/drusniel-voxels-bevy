import type { SelectionParams } from "../selection.js";
import type { ClodPageNode } from "../types.js";
import {
  CLOD_NODE_RECORD_BYTES,
  CLOD_NODE_RECORD_FLOATS,
  packClodNodeInto,
  packClodNodes,
} from "./clod_node_packing.js";
import type { WebGpuUnavailable } from "./webgpu_device.js";
import { requestWebGpuDevice } from "./webgpu_device.js";
import commonShader from "./shaders/clod_common.wgsl?raw";
import computeShader from "./shaders/webgpu_error_px.compute.wgsl?raw";

const WORKGROUP_SIZE = 64;
const PARAM_FLOATS = 8;
const READBACK_SLOTS = 2;

export interface ClodErrorComputeParams {
  camPos: [number, number, number];
  viewportH: number;
  fovY: number;
}

export interface ClodErrorMap {
  values: Float32Array;
  version: number;
  frameId: number;
  completedAt: number;
  params: ClodErrorComputeParams;
}

export interface ClodErrorPxStats {
  enabled: boolean;
  available: boolean;
  status: "unavailable" | "idle" | "running" | "ready" | "failed" | "disabled";
  reason?: string;
  nodeCount: number;
  version: number;
  latestAgeFrames: number | null;
  dispatchMs: number | null;
  readbackMs: number | null;
  skippedDispatches: number;
  parity: "unchecked" | "ok" | "failed" | "disabled";
  parityMaxDelta: number | null;
}

export interface ClodErrorPxComputeCreateResult {
  compute: ClodErrorPxCompute | null;
  unavailable: WebGpuUnavailable | null;
}

interface ReadbackSlot {
  buffer: GPUBuffer;
  busy: boolean;
  // Reusable CPU mirror so a per-frame readback does not allocate. Sized to nodeCount.
  cpu: Float32Array;
}

function cloneParams(params: ClodErrorComputeParams): ClodErrorComputeParams {
  return {
    camPos: [...params.camPos],
    viewportH: params.viewportH,
    fovY: params.fovY,
  };
}

function paramsFromSelection(params: SelectionParams): ClodErrorComputeParams {
  return {
    camPos: [...params.camPos],
    viewportH: params.viewportH,
    fovY: params.fovY,
  };
}

function writeFloat32Buffer(device: GPUDevice, buffer: GPUBuffer, offset: number, data: Float32Array): void {
  device.queue.writeBuffer(buffer, offset, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
}

export class ClodErrorPxCompute {
  private nodeBuffer: GPUBuffer;
  private outputBuffer: GPUBuffer;
  private paramBuffer: GPUBuffer;
  private bindGroup: GPUBindGroup;
  private readonly readbacks: ReadbackSlot[];
  private readonly paramScratch = new Float32Array(PARAM_FLOATS);
  private latest: ClodErrorMap | null = null;
  // Bumped whenever node buffers are replaced/destroyed so in-flight readbacks
  // captured against old buffers can detect they are stale and bail.
  private generation = 0;
  private running = 0;
  private failedReason: string | null = null;
  private dispatchMs: number | null = null;
  private readbackMs: number | null = null;
  private skippedDispatches = 0;
  private parity: ClodErrorPxStats["parity"] = "unchecked";
  private parityMaxDelta: number | null = null;
  private version = 0;
  private nodeIndexById = new Map<string, number>();
  private nodeCount = 0;

  private constructor(
    private readonly device: GPUDevice,
    private readonly pipeline: GPUComputePipeline,
    nodes: readonly ClodPageNode[],
  ) {
    const packed = packClodNodes(nodes);
    this.nodeIndexById = packed.nodeIndexById;
    this.nodeCount = nodes.length;

    const nodeBytes = Math.max(CLOD_NODE_RECORD_BYTES, packed.data.byteLength);
    const outputBytes = Math.max(Float32Array.BYTES_PER_ELEMENT, this.nodeCount * Float32Array.BYTES_PER_ELEMENT);
    this.nodeBuffer = this.device.createBuffer({
      label: "clod error px nodes",
      size: nodeBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.outputBuffer = this.device.createBuffer({
      label: "clod error px output",
      size: outputBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this.paramBuffer = this.device.createBuffer({
      label: "clod error px params",
      size: PARAM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.readbacks = this.createReadbackSlots(outputBytes);
    this.bindGroup = this.device.createBindGroup({
      label: "clod error px bind group",
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.nodeBuffer } },
        { binding: 1, resource: { buffer: this.paramBuffer } },
        { binding: 2, resource: { buffer: this.outputBuffer } },
      ],
    });
    writeFloat32Buffer(this.device, this.nodeBuffer, 0, packed.data);
  }

  private createReadbackSlots(outputBytes: number): ReadbackSlot[] {
    return Array.from({ length: READBACK_SLOTS }, (_, index) => ({
      buffer: this.device.createBuffer({
        label: `clod error px readback ${index}`,
        size: outputBytes,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }),
      busy: false,
      cpu: new Float32Array(Math.max(1, this.nodeCount)),
    }));
  }

  static async create(
    nodes: readonly ClodPageNode[],
    sharedDevice?: GPUDevice,
  ): Promise<ClodErrorPxComputeCreateResult> {
    let device = sharedDevice ?? null;
    if (!device) {
      const deviceResult = await requestWebGpuDevice();
      if (!deviceResult.ok) return { compute: null, unavailable: deviceResult };
      device = deviceResult.device;
    }

    const shader = device.createShaderModule({
      label: "clod error px shader",
      code: `${commonShader}\n${computeShader}`,
    });
    const pipeline = await device.createComputePipelineAsync({
      label: "clod error px pipeline",
      layout: "auto",
      compute: {
        module: shader,
        entryPoint: "compute_clod_error_px",
      },
    });
    return { compute: new ClodErrorPxCompute(device, pipeline, nodes), unavailable: null };
  }

  setNodes(nodes: readonly ClodPageNode[]): void {
    const packed = packClodNodes(nodes);
    this.nodeIndexById = packed.nodeIndexById;
    this.nodeCount = nodes.length;
    this.version++;
    this.generation++;
    this.running = 0;
    this.latest = null;

    this.nodeBuffer.destroy();
    this.outputBuffer.destroy();
    // Busy readbacks have an in-flight mapAsync; freeing them here would reject that
    // callback against a destroyed buffer. The generation bump lets the stale callback
    // detect it lost ownership and self-destroy its buffer instead.
    for (const slot of this.readbacks) {
      if (!slot.busy) slot.buffer.destroy();
    }

    const nodeBytes = Math.max(CLOD_NODE_RECORD_BYTES, packed.data.byteLength);
    const outputBytes = Math.max(Float32Array.BYTES_PER_ELEMENT, this.nodeCount * Float32Array.BYTES_PER_ELEMENT);
    this.nodeBuffer = this.device.createBuffer({
      label: "clod error px nodes",
      size: nodeBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.outputBuffer = this.device.createBuffer({
      label: "clod error px output",
      size: outputBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this.readbacks.splice(0, this.readbacks.length, ...this.createReadbackSlots(outputBytes));
    this.bindGroup = this.device.createBindGroup({
      label: "clod error px bind group",
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.nodeBuffer } },
        { binding: 1, resource: { buffer: this.paramBuffer } },
        { binding: 2, resource: { buffer: this.outputBuffer } },
      ],
    });
    writeFloat32Buffer(this.device, this.nodeBuffer, 0, packed.data);
  }

  patchNodes(nodes: readonly ClodPageNode[]): void {
    if (nodes.length === 0) return;

    // Resolve to (bufferIndex, node) pairs, dropping nodes this compute does not own.
    const updates: { index: number; node: ClodPageNode }[] = [];
    for (const node of nodes) {
      const index = this.nodeIndexById.get(node.id);
      if (index !== undefined) updates.push({ index, node });
    }
    if (updates.length === 0) return;

    this.version++;
    this.latest = null;

    // Pack in buffer-index order, then flush each contiguous run as one writeBuffer.
    // A dig batch is typically a few neighbours, so runs collapse most small writes
    // into a single upload instead of one queue.writeBuffer per node.
    updates.sort((a, b) => a.index - b.index);
    const scratch = new Float32Array(updates.length * CLOD_NODE_RECORD_FLOATS);
    for (let i = 0; i < updates.length; i++) packClodNodeInto(scratch, i, updates[i].node);

    let runStart = 0;
    while (runStart < updates.length) {
      let runEnd = runStart;
      while (runEnd + 1 < updates.length && updates[runEnd + 1].index === updates[runEnd].index + 1) {
        runEnd++;
      }
      const floatStart = runStart * CLOD_NODE_RECORD_FLOATS;
      const floatEnd = (runEnd + 1) * CLOD_NODE_RECORD_FLOATS;
      writeFloat32Buffer(
        this.device,
        this.nodeBuffer,
        updates[runStart].index * CLOD_NODE_RECORD_BYTES,
        scratch.subarray(floatStart, floatEnd),
      );
      runStart = runEnd + 1;
    }
  }

  dispatch(selectionParams: SelectionParams, frameId: number): boolean {
    if (this.failedReason || this.nodeCount === 0) return false;
    const slot = this.readbacks.find((candidate) => !candidate.busy);
    if (!slot) {
      this.skippedDispatches++;
      return false;
    }

    const params = paramsFromSelection(selectionParams);
    this.paramScratch[0] = params.camPos[0];
    this.paramScratch[1] = params.camPos[1];
    this.paramScratch[2] = params.camPos[2];
    this.paramScratch[3] = params.viewportH;
    this.paramScratch[4] = params.fovY;
    this.paramScratch[5] = this.nodeCount;
    this.paramScratch[6] = 0;
    this.paramScratch[7] = 0;
    writeFloat32Buffer(this.device, this.paramBuffer, 0, this.paramScratch);

    const encoder = this.device.createCommandEncoder({ label: "clod error px encoder" });
    const pass = encoder.beginComputePass({ label: "clod error px pass" });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.nodeCount / WORKGROUP_SIZE));
    pass.end();
    encoder.copyBufferToBuffer(
      this.outputBuffer,
      0,
      slot.buffer,
      0,
      this.nodeCount * Float32Array.BYTES_PER_ELEMENT,
    );

    const submittedVersion = this.version;
    const submittedGeneration = this.generation;
    const submittedParams = cloneParams(params);
    const submitStart = performance.now();
    const valueBytes = this.nodeCount * Float32Array.BYTES_PER_ELEMENT;
    slot.busy = true;
    this.running++;
    this.device.queue.submit([encoder.finish()]);
    this.dispatchMs = performance.now() - submitStart;
    const readbackStart = performance.now();
    void slot.buffer.mapAsync(GPUMapMode.READ).then(() => {
      // setNodes/destroy replaced the buffers under us: this slot is orphaned. Release
      // its buffer (the new generation owns fresh ones) and do not publish a stale map.
      if (submittedGeneration !== this.generation) {
        slot.buffer.destroy();
        return;
      }
      const mapped = slot.buffer.getMappedRange(0, valueBytes);
      slot.cpu.set(new Float32Array(mapped));
      slot.buffer.unmap();
      slot.busy = false;
      this.running = Math.max(0, this.running - 1);
      this.readbackMs = performance.now() - readbackStart;
      this.latest = {
        values: slot.cpu,
        version: submittedVersion,
        frameId,
        completedAt: performance.now(),
        params: submittedParams,
      };
    }).catch((error) => {
      // A rejection from an orphaned slot (buffer destroyed by setNodes/destroy) is
      // expected; only a live-generation rejection is a real device failure.
      if (submittedGeneration !== this.generation) return;
      slot.busy = false;
      this.running = Math.max(0, this.running - 1);
      this.failedReason = error instanceof Error ? error.message : String(error);
    });
    return true;
  }

  latestFor(frameId: number, maxAgeFrames: number): ClodErrorMap | null {
    if (this.failedReason) return null;
    if (!this.latest || this.latest.version !== this.version) return null;
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

  markParityDisabled(): void {
    this.parity = "disabled";
  }

  stats(frameId: number, enabled: boolean): ClodErrorPxStats {
    const latestAgeFrames = this.latest ? frameId - this.latest.frameId : null;
    return {
      enabled,
      available: !this.failedReason,
      status: !enabled ? "disabled" : this.failedReason ? "failed" : this.running > 0 ? "running" : this.latest ? "ready" : "idle",
      reason: this.failedReason ?? undefined,
      nodeCount: this.nodeCount,
      version: this.version,
      latestAgeFrames,
      dispatchMs: this.dispatchMs,
      readbackMs: this.readbackMs,
      skippedDispatches: this.skippedDispatches,
      parity: this.parity,
      parityMaxDelta: this.parityMaxDelta,
    };
  }

  destroy(): void {
    // Orphan any in-flight readback so its callback bails instead of touching freed buffers.
    this.generation++;
    this.running = 0;
    this.nodeBuffer.destroy();
    this.outputBuffer.destroy();
    this.paramBuffer.destroy();
    for (const slot of this.readbacks) {
      if (!slot.busy) slot.buffer.destroy();
    }
  }
}
