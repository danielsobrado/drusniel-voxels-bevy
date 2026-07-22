import type { ClodPagesConfig } from "../../config.js";
import {
  DIG_EDIT_BYTES,
  FIELD_PARAM_WORDS,
  MESH_PARAM_WORDS,
  computeMeshDims,
  packDigEdits,
  packFieldParams,
  packMeshParams,
  type MeshDims,
} from "../../gpu/gpu_mesh_buffers.js";
import type { WorldBounds } from "../terrain_surface.js";
import {
  RootGpuBatchLimitError,
  type GpuRootChunkPlan,
} from "./gpu_clod_root_batch_buffers.js";
import type { HeightAtlasBindings } from "./gpu_clod_root_field_shader.js";

const F32 = Float32Array.BYTES_PER_ELEMENT;
const U32 = Uint32Array.BYTES_PER_ELEMENT;
const STORAGE = (extra = 0) => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | extra;

export interface GpuRootChunkSlot extends GpuRootChunkPlan {
  dims: MeshDims;
  counterSlot: number;
  positionOffsetBytes: number;
  normalOffsetBytes: number;
  materialOffsetBytes: number;
  indexOffsetBytes: number;
  bindGroup: GPUBindGroup;
}

export class PackedRootGpuBufferPool {
  readonly dims: MeshDims;
  readonly positionStrideBytes: number;
  readonly normalStrideBytes: number;
  readonly materialStrideBytes: number;
  readonly cellIndexStrideBytes: number;
  readonly indexStrideBytes: number;
  readonly digEdits: GPUBuffer;
  readonly fieldParams: GPUBuffer;
  readonly positions: GPUBuffer;
  readonly normals: GPUBuffer;
  readonly materials: GPUBuffer;
  readonly cellIndex: GPUBuffer;
  readonly indices: GPUBuffer;
  readonly indexCounts: GPUBuffer;
  readonly vertexCounts: GPUBuffer;
  private readonly meshParams: GPUBuffer[] = [];
  private readonly bindGroups: GPUBindGroup[] = [];

  constructor(
    private readonly device: GPUDevice,
    private readonly layout: GPUBindGroupLayout,
    private readonly cfg: ClodPagesConfig,
    private readonly world: WorldBounds,
    readonly capacity: number,
    private readonly heightAtlas: HeightAtlasBindings,
  ) {
    this.dims = computeMeshDims(0, 0, cfg.page.chunk_size);
    this.positionStrideBytes = this.dims.maxVertices * 3 * F32;
    this.normalStrideBytes = this.dims.maxVertices * 3 * F32;
    this.materialStrideBytes = this.dims.maxVertices * F32;
    this.cellIndexStrideBytes = this.dims.slotCount * U32;
    this.indexStrideBytes = this.dims.maxIndices * U32;
    const mk = (label: string, size: number, usage: number) => device.createBuffer({
      label: `gpu clod root pool ${label}`,
      size: Math.max(4, size),
      usage,
    });
    this.digEdits = mk("digEdits", DIG_EDIT_BYTES, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.fieldParams = mk("fieldParams", FIELD_PARAM_WORDS * U32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.positions = mk("positions", this.positionStrideBytes * capacity, STORAGE());
    this.normals = mk("normals", this.normalStrideBytes * capacity, STORAGE());
    this.materials = mk("materials", this.materialStrideBytes * capacity, STORAGE());
    this.cellIndex = mk("cellIndex", this.cellIndexStrideBytes * capacity, STORAGE());
    this.indices = mk("indices", this.indexStrideBytes * capacity, STORAGE());
    this.indexCounts = mk("indexCounts", U32 * capacity, STORAGE(GPUBufferUsage.COPY_DST));
    this.vertexCounts = mk("vertexCounts", U32 * capacity, STORAGE(GPUBufferUsage.COPY_DST));
    for (let slot = 0; slot < capacity; slot++) this.createSlotResources(slot);
  }

  prepare(plans: readonly GpuRootChunkPlan[]): GpuRootChunkSlot[] {
    if (plans.length > this.capacity) {
      throw new RootGpuBatchLimitError(
        `GPU streamed-root packed pool needs ${plans.length} slots, capacity ${this.capacity}`,
        plans[0] ? { px: plans[0].rootPx, pz: plans[0].rootPz, level: plans[0].rootLevel } : { px: 0, pz: 0 },
        plans.length,
        0,
        { batchSize: 1, maxChunkSlots: this.capacity, maxTotalSlotBytes: 0 },
      );
    }
    this.device.queue.writeBuffer(this.digEdits, 0, packDigEdits([]));
    this.device.queue.writeBuffer(this.fieldParams, 0, packFieldParams(0) as Uint32Array<ArrayBuffer>);
    const zeros = new Uint32Array(Math.max(1, plans.length));
    this.device.queue.writeBuffer(this.indexCounts, 0, zeros.buffer as ArrayBuffer, zeros.byteOffset, plans.length * U32);
    this.device.queue.writeBuffer(this.vertexCounts, 0, zeros.buffer as ArrayBuffer, zeros.byteOffset, plans.length * U32);
    return plans.map((plan) => this.prepareSlot(plan));
  }

  destroy(): void {
    this.digEdits.destroy();
    this.fieldParams.destroy();
    this.positions.destroy();
    this.normals.destroy();
    this.materials.destroy();
    this.cellIndex.destroy();
    this.indices.destroy();
    this.indexCounts.destroy();
    this.vertexCounts.destroy();
    for (const buffer of this.meshParams) buffer.destroy();
  }

  private createSlotResources(slot: number): void {
    const meshParams = this.device.createBuffer({
      label: `gpu clod root pool meshParams ${slot}`,
      size: MESH_PARAM_WORDS * U32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.meshParams[slot] = meshParams;
    this.bindGroups[slot] = this.device.createBindGroup({
      label: `gpu clod root pool bind group ${slot}`,
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: this.digEdits } },
        { binding: 1, resource: { buffer: this.fieldParams } },
        { binding: 2, resource: { buffer: meshParams } },
        { binding: 3, resource: { buffer: this.positions } },
        { binding: 4, resource: { buffer: this.normals } },
        { binding: 5, resource: { buffer: this.materials } },
        { binding: 6, resource: { buffer: this.cellIndex } },
        { binding: 7, resource: { buffer: this.indices } },
        { binding: 8, resource: { buffer: this.indexCounts } },
        { binding: 9, resource: { buffer: this.vertexCounts } },
        { binding: 10, resource: this.heightAtlas.view },
        { binding: 11, resource: { buffer: this.heightAtlas.params } },
      ],
    });
  }

  private prepareSlot(plan: GpuRootChunkPlan): GpuRootChunkSlot {
    const dims = computeMeshDims(plan.cx, plan.cz, this.cfg.page.chunk_size, plan.vyBase ?? -1);
    const counterSlot = plan.slotIndex;
    const positionBaseF32 = (this.positionStrideBytes / F32) * counterSlot;
    const normalBaseF32 = (this.normalStrideBytes / F32) * counterSlot;
    const materialBaseF32 = (this.materialStrideBytes / F32) * counterSlot;
    const cellIndexBase = (this.cellIndexStrideBytes / U32) * counterSlot;
    const indexBase = (this.indexStrideBytes / U32) * counterSlot;
    this.device.queue.writeBuffer(
      this.meshParams[counterSlot]!,
      0,
      packMeshParams(dims, this.world, { positionBaseF32, normalBaseF32, materialBaseF32, cellIndexBase, indexBase, counterSlot }) as Int32Array<ArrayBuffer>,
    );
    return {
      ...plan,
      dims,
      counterSlot,
      positionOffsetBytes: positionBaseF32 * F32,
      normalOffsetBytes: normalBaseF32 * F32,
      materialOffsetBytes: materialBaseF32 * F32,
      indexOffsetBytes: indexBase * U32,
      bindGroup: this.bindGroups[counterSlot]!,
    };
  }
}
