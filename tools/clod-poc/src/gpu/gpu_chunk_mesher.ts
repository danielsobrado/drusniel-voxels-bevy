// GPU Surface Nets driver: runs vertexPass + quadPass (shaders/terrain_field_entry.wgsl,
// composed with terrain field bindings/common) for one chunk and reads back the compact mesh, so
// the heavy field + meshing
// math leaves the main thread. The compute math is verified equivalent to terrain.ts meshChunk via
// surface_nets_core.test.ts; this driver's pure parts (buffer layout/packing) are verified by
// gpu_mesh_buffers.test.ts. The GPU dispatch + readback wiring itself is browser-QA only (WebGPU
// cannot run headless). Conventions mirror clod_error_px_compute.ts (requestWebGpuDevice, explicit
// layout, mapAsync readback). Calls are serialized — shared buffers mean one chunk at a time.

import { requestWebGpuDevice } from "./webgpu_device.js";
import type { WebGpuUnavailable } from "./webgpu_device.js";
import { ResolvedDigEdit } from "./terrain_field_core.js";
import {
  Y_CELLS,
  computeMeshDims,
  packMeshParams,
  packFieldParams,
  packDigEdits,
  assembleChunkMesh,
  DIG_EDIT_BYTES,
} from "./gpu_mesh_buffers.js";
import { composeTerrainFieldShader } from "./wgsl_modules.js";

const WORKGROUP_SIZE = 64;
const F32 = Float32Array.BYTES_PER_ELEMENT;
const U32 = Uint32Array.BYTES_PER_ELEMENT;

export interface ChunkMesh {
  positions: Float32Array;
  normals: Float32Array;
  materials: Float32Array;
  materialWeights?: Float32Array;
  materialWeightStride?: number;
  indices: Uint32Array;
}

export interface GpuChunkMesherCreateResult {
  mesher: GpuChunkMesher | null;
  unavailable: WebGpuUnavailable | null;
}

const STORAGE = (extra = 0) => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | extra;

export class GpuChunkMesher {
  private readonly slotCount: number;
  private readonly maxVertices: number;
  private readonly maxIndices: number;
  private readonly edgeCount: number;
  private editCapacity: number;

  private digEdits: GPUBuffer;
  private readonly fieldParams: GPUBuffer;
  private readonly meshParams: GPUBuffer;
  private readonly outPositions: GPUBuffer;
  private readonly outNormals: GPUBuffer;
  private readonly outMaterials: GPUBuffer;
  private readonly cellIndex: GPUBuffer;
  private readonly outIndices: GPUBuffer;
  private readonly indexCount: GPUBuffer;
  private readonly vertexCount: GPUBuffer;
  private readonly countReadback: GPUBuffer;
  private bindGroup: GPUBindGroup;
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly device: GPUDevice,
    private readonly layout: GPUBindGroupLayout,
    private readonly vertexPipeline: GPUComputePipeline,
    private readonly quadPipeline: GPUComputePipeline,
    private readonly S: number,
    initialEditCapacity: number,
  ) {
    const dims = computeMeshDims(0, 0, S);
    this.slotCount = dims.slotCount;
    this.maxVertices = dims.maxVertices;
    this.maxIndices = dims.maxIndices;
    this.edgeCount = S * S * Y_CELLS * 3;
    this.editCapacity = Math.max(1, initialEditCapacity);

    const mk = (label: string, size: number, usage: number) =>
      device.createBuffer({ label: `gpu mesher ${label}`, size, usage });

    this.digEdits = mk("digEdits", this.editCapacity * DIG_EDIT_BYTES, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.fieldParams = mk("fieldParams", 4 * U32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.meshParams = mk("meshParams", 16 * U32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.outPositions = mk("positions", this.maxVertices * 3 * F32, STORAGE());
    this.outNormals = mk("normals", this.maxVertices * 3 * F32, STORAGE());
    this.outMaterials = mk("materials", this.maxVertices * F32, STORAGE());
    this.cellIndex = mk("cellIndex", this.slotCount * U32, STORAGE());
    this.outIndices = mk("indices", this.maxIndices * U32, STORAGE());
    this.indexCount = mk("indexCount", U32, STORAGE(GPUBufferUsage.COPY_DST));
    this.vertexCount = mk("vertexCount", U32, STORAGE(GPUBufferUsage.COPY_DST));
    this.countReadback = mk("countReadback", 2 * U32, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    this.bindGroup = this.makeBindGroup();
  }

  // The TypedArray generic (ArrayBufferLike) is not directly a GPU BufferSource; pass the backing
  // ArrayBuffer + range, as clod_error_px_compute.ts does.
  private writeView(buffer: GPUBuffer, data: Int32Array | Uint32Array): void {
    this.device.queue.writeBuffer(buffer, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  }

  private makeBindGroup(): GPUBindGroup {
    return this.device.createBindGroup({
      label: "gpu mesher bind group",
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: this.digEdits } },
        { binding: 1, resource: { buffer: this.fieldParams } },
        { binding: 2, resource: { buffer: this.meshParams } },
        { binding: 3, resource: { buffer: this.outPositions } },
        { binding: 4, resource: { buffer: this.outNormals } },
        { binding: 5, resource: { buffer: this.outMaterials } },
        { binding: 6, resource: { buffer: this.cellIndex } },
        { binding: 7, resource: { buffer: this.outIndices } },
        { binding: 8, resource: { buffer: this.indexCount } },
        { binding: 9, resource: { buffer: this.vertexCount } },
      ],
    });
  }

  static async create(
    chunkSize: number,
    opts: { sharedDevice?: GPUDevice; initialEditCapacity?: number } = {},
  ): Promise<GpuChunkMesherCreateResult> {
    let device = opts.sharedDevice ?? null;
    if (!device) {
      const result = await requestWebGpuDevice();
      if (!result.ok) return { mesher: null, unavailable: result };
      device = result.device;
    }
    const module = device.createShaderModule({
      label: "gpu mesher shader",
      code: composeTerrainFieldShader(),
    });
    const storage = (i: number): GPUBindGroupLayoutEntry => ({
      binding: i,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: "storage" },
    });
    const layout = device.createBindGroupLayout({
      label: "gpu mesher layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        storage(3), storage(4), storage(5), storage(6), storage(7), storage(8), storage(9),
      ],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const [vertexPipeline, quadPipeline] = await Promise.all([
      device.createComputePipelineAsync({
        label: "gpu mesher vertexPass",
        layout: pipelineLayout,
        compute: { module, entryPoint: "vertexPass" },
      }),
      device.createComputePipelineAsync({
        label: "gpu mesher quadPass",
        layout: pipelineLayout,
        compute: { module, entryPoint: "quadPass" },
      }),
    ]);
    const mesher = new GpuChunkMesher(
      device, layout, vertexPipeline, quadPipeline, chunkSize, opts.initialEditCapacity ?? 32,
    );
    return { mesher, unavailable: null };
  }

  /** Mesh one chunk on the GPU and read back the compact result. Serialized via an internal queue
   *  because the work buffers are shared. */
  meshChunk(cx: number, cz: number, world: { cellsX: number; cellsZ: number }, edits: readonly ResolvedDigEdit[]): Promise<ChunkMesh> {
    const run = this.queue.then(() => this.meshChunkInner(cx, cz, world, edits));
    // Keep the chain alive regardless of individual failures.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async meshChunkInner(
    cx: number,
    cz: number,
    world: { cellsX: number; cellsZ: number },
    edits: readonly ResolvedDigEdit[],
  ): Promise<ChunkMesh> {
    if (edits.length > this.editCapacity) {
      this.editCapacity = edits.length;
      this.digEdits.destroy();
      this.digEdits = this.device.createBuffer({
        label: "gpu mesher digEdits",
        size: this.editCapacity * DIG_EDIT_BYTES,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.bindGroup = this.makeBindGroup();
    }

    const dims = computeMeshDims(cx, cz, this.S);
    this.device.queue.writeBuffer(this.digEdits, 0, packDigEdits(edits));
    this.writeView(this.fieldParams, packFieldParams(edits.length));
    this.writeView(this.meshParams, packMeshParams(dims, world));
    const zero = new Uint32Array([0]);
    this.writeView(this.indexCount, zero);
    this.writeView(this.vertexCount, zero);

    // Pass 1: vertices. Pass 2: quads (ordered after pass 1 on the same queue). Then copy the two
    // counts to a small readback so we only transfer the live verts/indices in phase 2.
    const enc = this.device.createCommandEncoder({ label: "gpu mesher encode" });
    const vpass = enc.beginComputePass();
    vpass.setPipeline(this.vertexPipeline);
    vpass.setBindGroup(0, this.bindGroup);
    vpass.dispatchWorkgroups(Math.ceil(this.slotCount / WORKGROUP_SIZE));
    vpass.end();
    const qpass = enc.beginComputePass();
    qpass.setPipeline(this.quadPipeline);
    qpass.setBindGroup(0, this.bindGroup);
    qpass.dispatchWorkgroups(Math.ceil(this.edgeCount / WORKGROUP_SIZE));
    qpass.end();
    enc.copyBufferToBuffer(this.vertexCount, 0, this.countReadback, 0, U32);
    enc.copyBufferToBuffer(this.indexCount, 0, this.countReadback, U32, U32);
    this.device.queue.submit([enc.finish()]);

    await this.countReadback.mapAsync(GPUMapMode.READ);
    const counts = new Uint32Array(this.countReadback.getMappedRange().slice(0));
    this.countReadback.unmap();
    const vc = Math.min(counts[0], this.maxVertices);
    const ic = Math.min(counts[1], this.maxIndices);
    if (vc === 0 || ic === 0) {
      return { positions: new Float32Array(0), normals: new Float32Array(0), materials: new Float32Array(0), indices: new Uint32Array(0) };
    }

    // Phase 2: copy exactly the live ranges to sized readback buffers.
    const posRB = this.device.createBuffer({ label: "rb pos", size: vc * 3 * F32, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const nrmRB = this.device.createBuffer({ label: "rb nrm", size: vc * 3 * F32, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const matRB = this.device.createBuffer({ label: "rb mat", size: vc * F32, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const idxRB = this.device.createBuffer({ label: "rb idx", size: ic * U32, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc2 = this.device.createCommandEncoder({ label: "gpu mesher readback" });
    enc2.copyBufferToBuffer(this.outPositions, 0, posRB, 0, vc * 3 * F32);
    enc2.copyBufferToBuffer(this.outNormals, 0, nrmRB, 0, vc * 3 * F32);
    enc2.copyBufferToBuffer(this.outMaterials, 0, matRB, 0, vc * F32);
    enc2.copyBufferToBuffer(this.outIndices, 0, idxRB, 0, ic * U32);
    this.device.queue.submit([enc2.finish()]);

    await Promise.all([
      posRB.mapAsync(GPUMapMode.READ),
      nrmRB.mapAsync(GPUMapMode.READ),
      matRB.mapAsync(GPUMapMode.READ),
      idxRB.mapAsync(GPUMapMode.READ),
    ]);
    const mesh = assembleChunkMesh(
      new Float32Array(posRB.getMappedRange().slice(0)),
      new Float32Array(nrmRB.getMappedRange().slice(0)),
      new Float32Array(matRB.getMappedRange().slice(0)),
      new Uint32Array(idxRB.getMappedRange().slice(0)),
      vc,
      ic,
    );
    posRB.unmap(); nrmRB.unmap(); matRB.unmap(); idxRB.unmap();
    posRB.destroy(); nrmRB.destroy(); matRB.destroy(); idxRB.destroy();
    return mesh;
  }

  destroy(): void {
    this.digEdits.destroy();
    this.fieldParams.destroy();
    this.meshParams.destroy();
    this.outPositions.destroy();
    this.outNormals.destroy();
    this.outMaterials.destroy();
    this.cellIndex.destroy();
    this.outIndices.destroy();
    this.indexCount.destroy();
    this.vertexCount.destroy();
    this.countReadback.destroy();
  }
}
