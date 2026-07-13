import type { ClodPagesConfig } from "../../config.js";
import { initSimplifier, simplifyPage } from "../../clod/simplify.js";
import { concatPageSourceMeshes, filterPageSourceSections } from "../../clod/pageSource.js";
import type { PageSourceSection } from "../../clod/pageSourceSections.js";
import { weldVertices } from "../../clod/weld.js";
import {
  assertNoInternalBorders,
  stripDegenerateTriangles,
  validateFinalPageMesh,
  validatePageMesh,
  validateWeldedIntermediate,
} from "../../clod/validate.js";
import {
  boundsOf,
  clonePageMesh,
  footprintFor,
  INITIAL_NODE_REVISION,
  requireFourChildren,
} from "../../clod/quadtree_support.js";
import {
  DIG_EDIT_BYTES,
  FIELD_PARAM_WORDS,
  MESH_PARAM_WORDS,
  Y_CELLS,
  assembleChunkMesh,
  computeMeshDims,
  packDigEdits,
  packFieldParams,
  packMeshParams,
  type MeshDims,
} from "../../gpu/gpu_mesh_buffers.js";
import { composeTerrainFieldShader } from "../../gpu/wgsl_modules.js";
import { requestWebGpuDevice } from "../../gpu/webgpu_device.js";
import { buildOuterBorderLocks } from "../../lock.js";
import { ClodBuildError, type ClodPageNode, type PageMesh } from "../../types.js";
import type { WorldBounds } from "../terrain_surface.js";
import {
  RootGpuBatchLimitError,
  chunkSlotsPerRootPage,
  estimateChunkSlotBytes,
  estimateRootRequestReadbackBytes,
  estimateRootRequestSlotBytes,
  findChunkVerticesOutOfBounds,
  planGeometryReadbackLayout,
  planRootBatchChunkSlots,
  rootLevelForRequest,
  splitRootGpuBatches,
  type GpuRootChunkPlan,
  type RootBatchPageConfig,
  type RootGpuBatchLimits,
} from "./gpu_clod_root_batch_buffers.js";
import type { StreamingRootGpuMesherConfig } from "./streamed_root_gpu_config.js";
import { createHeightfieldTileGpuAtlas } from "../../world/heightfield_tiles/heightfield_tile_gpu_atlas.js";
import { continentTileMeshingEnabled } from "./streamed_root_gpu_config.js";

const STREAM_COUNTER_SAMPLE_LIMIT = 128;
const DEFAULT_MATERIAL_WEIGHT_STRIDE = 4;
const WORKGROUP_SIZE = 64;
const F32 = Float32Array.BYTES_PER_ELEMENT;
const U32 = Uint32Array.BYTES_PER_ELEMENT;
const DEFAULT_MAX_BATCH_CHUNK_SLOTS = 64;
const DEFAULT_MAX_TOTAL_SLOT_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_READBACK_BUFFER_BYTES = 256 * 1024 * 1024;
const READBACK_BUFFER_HEADROOM = 0.75;
const TOTAL_SLOT_BUFFER_HEADROOM = 2;
const STORAGE = (extra = 0) => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | extra;

interface ChunkMesh {
  positions: Float32Array;
  normals: Float32Array;
  materials: Float32Array;
  materialWeights?: Float32Array;
  materialWeightStride?: number;
  indices: Uint32Array;
}

export interface GpuClodRootBuildRequest {
  px: number;
  pz: number;
  level?: number;
}

export interface GpuClodRootBuildResult {
  nodes: ClodPageNode[];
  buildMs: number;
  transferBytes: number;
}

export interface GpuClodRootMesherStats {
  enabled: number;
  batchesDispatched: number;
  pagesDispatched: number;
  batchPagesP95: number;
  chunkSlotsDispatched: number;
  encodeSubmitMsP50: number;
  encodeSubmitMsP95: number;
  countReadbackMsP95: number;
  geometryReadbackMsP95: number;
  buildMsP50: number;
  buildMsP95: number;
  buildMsMax: number;
  readbackMsP95: number;
  fallbackPages: number;
  failedBatches: number;
  workerFallbackPages: number;
}

export interface GpuClodRootMesher {
  buildPages(batch: readonly GpuClodRootBuildRequest[]): Promise<GpuClodRootBuildResult>;
  stats(): GpuClodRootMesherStats;
  recordFallbackPages(count: number): void;
  recordWorkerFallbackPages(count: number): void;
  dispose(): void;
}

export interface CreateGpuClodRootMesherOptions {
  cfg: ClodPagesConfig;
  world: WorldBounds;
  config: StreamingRootGpuMesherConfig;
  sharedDevice?: GPUDevice;
}

interface GpuRootChunkSlot extends GpuRootChunkPlan {
  dims: MeshDims;
  counterSlot: number;
  positionOffsetBytes: number;
  normalOffsetBytes: number;
  materialOffsetBytes: number;
  indexOffsetBytes: number;
  bindGroup: GPUBindGroup;
}

interface RuntimeBatchLimits extends RootGpuBatchLimits {
  maxReadbackBufferBytes: number;
}

interface HeightAtlasBindings {
  readonly view: GPUTextureView;
  readonly params: GPUBuffer;
  readonly dispose?: () => void;
}

class PackedRootGpuBufferPool {
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
    const dims = computeMeshDims(plan.cx, plan.cz, this.cfg.page.chunk_size);
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

class BatchedGpuClodRootMesher implements GpuClodRootMesher {
  private readonly buildSamples: number[] = [];
  private readonly countReadbackSamples: number[] = [];
  private readonly geometryReadbackSamples: number[] = [];
  private readonly encodeSubmitSamples: number[] = [];
  private readonly batchPageSamples: number[] = [];
  private batchesDispatched = 0;
  private pagesDispatched = 0;
  private chunkSlotsDispatched = 0;
  private fallbackPages = 0;
  private failedBatches = 0;
  private workerFallbackPages = 0;
  private disabledError: Error | null = null;
  private readonly simplifierReady = initSimplifier();
  private readonly batchLimits: RuntimeBatchLimits;
  private readonly pool: PackedRootGpuBufferPool;
  private buildTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly device: GPUDevice,
    layout: GPUBindGroupLayout,
    private readonly vertexPipeline: GPUComputePipeline,
    private readonly quadPipeline: GPUComputePipeline,
    private readonly cfg: ClodPagesConfig,
    world: WorldBounds,
    config: StreamingRootGpuMesherConfig,
    private readonly heightAtlas: HeightAtlasBindings,
  ) {
    this.batchLimits = resolveRuntimeBatchLimits(device, config, cfg.page.chunk_size);
    this.pool = new PackedRootGpuBufferPool(device, layout, cfg, world, this.batchLimits.maxChunkSlots, heightAtlas);
  }

  /**
   * Serialize builds. This mesher owns a single PackedRootGpuBufferPool whose slot indices (0..N) are
   * reused on every batch, so two concurrent builds — the streaming controller dispatches up to
   * maxInflightBatches at once — would have batch B's prepare() zero the counters, rewrite meshParams
   * and overwrite pool.positions at the same offsets while batch A is between its count and geometry
   * readbacks, so A reads B's geometry (mixed-page "stale GPU pool geometry"). One build at a time per
   * pool is the pool's invariant; enforce it here regardless of caller. buildTail only ever resolves
   * (never rejects), so awaiting it cannot leak a prior build's failure into the next.
   */
  async buildPages(batch: readonly GpuClodRootBuildRequest[]): Promise<GpuClodRootBuildResult> {
    const prior = this.buildTail;
    let release!: () => void;
    this.buildTail = new Promise<void>((resolve) => { release = resolve; });
    try {
      await prior;
      return await this.runBuildPages(batch);
    } finally {
      release();
    }
  }

  private async runBuildPages(batch: readonly GpuClodRootBuildRequest[]): Promise<GpuClodRootBuildResult> {
    if (batch.length === 0) return { nodes: [], buildMs: 0, transferBytes: 0 };
    if (this.disabledError) throw this.disabledError;
    const startedAt = performance.now();
    try {
      await this.simplifierReady;
      this.pagesDispatched += batch.length;
      const nodes = await this.buildRootBatch(batch);
      const buildMs = performance.now() - startedAt;
      pushSample(this.buildSamples, buildMs);
      return { nodes, buildMs, transferBytes: nodes.reduce((sum, node) => sum + transferBytesForNode(node), 0) };
    } catch (error) {
      this.failedBatches++;
      if (isHardGpuFailure(error)) this.disabledError = error instanceof Error ? error : new Error(String(error));
      throw error;
    } finally {
      publishGpuClodRootMesherCounters(this.stats());
    }
  }

  stats(): GpuClodRootMesherStats {
    return {
      enabled: this.disabledError ? 0 : 1,
      batchesDispatched: this.batchesDispatched,
      pagesDispatched: this.pagesDispatched,
      batchPagesP95: percentile(this.batchPageSamples, 0.95),
      chunkSlotsDispatched: this.chunkSlotsDispatched,
      encodeSubmitMsP50: percentile(this.encodeSubmitSamples, 0.5),
      encodeSubmitMsP95: percentile(this.encodeSubmitSamples, 0.95),
      countReadbackMsP95: percentile(this.countReadbackSamples, 0.95),
      geometryReadbackMsP95: percentile(this.geometryReadbackSamples, 0.95),
      buildMsP50: percentile(this.buildSamples, 0.5),
      buildMsP95: percentile(this.buildSamples, 0.95),
      buildMsMax: this.buildSamples.reduce((max, value) => Math.max(max, value), 0),
      readbackMsP95: percentile([...this.countReadbackSamples, ...this.geometryReadbackSamples], 0.95),
      fallbackPages: this.fallbackPages,
      failedBatches: this.failedBatches,
      workerFallbackPages: this.workerFallbackPages,
    };
  }

  recordFallbackPages(count: number): void {
    this.fallbackPages += Math.max(0, Math.floor(count));
    publishGpuClodRootMesherCounters(this.stats());
  }

  recordWorkerFallbackPages(count: number): void {
    this.workerFallbackPages += Math.max(0, Math.floor(count));
    publishGpuClodRootMesherCounters(this.stats());
  }

  dispose(): void {
    this.pool.destroy();
    this.heightAtlas.dispose?.();
  }

  private rootBatchPageConfig(): RootBatchPageConfig {
    return {
      chunks_per_page: this.cfg.page.chunks_per_page,
      chunk_size: this.cfg.page.chunk_size,
      quadtree_levels: this.cfg.page.quadtree_levels,
    };
  }

  private async buildRootBatch(batch: readonly GpuClodRootBuildRequest[]): Promise<ClodPageNode[]> {
    const cfg = this.rootBatchPageConfig();
    const directRequests: GpuClodRootBuildRequest[] = [];
    const nodesById = new Map<string, ClodPageNode>();

    for (const request of batch) {
      const rootLevel = rootLevelForRequest(request, cfg);
      if (this.requestFitsDirectGpuBatch(request, rootLevel, cfg)) {
        directRequests.push(request);
        continue;
      }
      const node = await this.buildOversizedRootFromLod0(request, rootLevel);
      nodesById.set(node.id, node);
    }

    for (const node of await this.buildRootSubBatch(directRequests)) nodesById.set(node.id, node);

    return batch.map((request) => {
      const id = this.rootNodeId(request, cfg);
      const node = nodesById.get(id);
      if (!node) throw new Error(`GPU streamed-root request ${id} produced no node`);
      return node;
    });
  }

  private requestFitsDirectGpuBatch(
    request: GpuClodRootBuildRequest,
    rootLevel: number,
    cfg: RootBatchPageConfig,
  ): boolean {
    const slots = chunkSlotsPerRootPage(cfg.chunks_per_page, rootLevel);
    const bytes = estimateRootRequestSlotBytes(request, cfg);
    const readbackBytes = estimateRootRequestReadbackBytes(request, cfg);
    return slots <= this.batchLimits.maxChunkSlots
      && bytes <= this.batchLimits.maxTotalSlotBytes
      && readbackBytes <= this.batchLimits.maxReadbackBufferBytes;
  }

  private rootNodeId(request: GpuClodRootBuildRequest, cfg: RootBatchPageConfig): string {
    const rootLevel = rootLevelForRequest(request, cfg);
    return `L${rootLevel}:${request.px},${request.pz}`;
  }

  private async buildOversizedRootFromLod0(request: GpuClodRootBuildRequest, rootLevel: number): Promise<ClodPageNode> {
    if (rootLevel <= 0) {
      throw new RootGpuBatchLimitError(
        `GPU streamed-root L0:${request.px},${request.pz} exceeds packed pool limits`,
        request,
        0,
        0,
        this.batchLimits,
      );
    }
    const lod0Scale = 2 ** rootLevel;
    const lod0Requests: GpuClodRootBuildRequest[] = [];
    for (let dz = 0; dz < lod0Scale; dz++) {
      for (let dx = 0; dx < lod0Scale; dx++) {
        lod0Requests.push({ px: request.px * lod0Scale + dx, pz: request.pz * lod0Scale + dz, level: 0 });
      }
    }
    const lod0Nodes = new Map<string, ClodPageNode>();
    for (const subBatch of splitRootGpuBatches(lod0Requests, this.rootBatchPageConfig(), this.batchLimits)) {
      for (const node of await this.buildRootSubBatch(subBatch)) {
        if (node.level !== 0) throw new Error(`GPU streamed-root oversized split expected L0 node, got ${node.id}`);
        lod0Nodes.set(node.id.slice(3), node);
      }
    }
    return this.buildRootPageFromLod0(request, lod0Nodes);
  }

  private async buildRootSubBatch(batch: readonly GpuClodRootBuildRequest[]): Promise<ClodPageNode[]> {
    const subBatches = splitRootGpuBatches(batch, this.rootBatchPageConfig(), this.batchLimits);
    const nodes: ClodPageNode[] = [];
    for (const subBatch of subBatches) {
      this.batchesDispatched++;
      pushSample(this.batchPageSamples, subBatch.length);
      const plans = planRootBatchChunkSlots(subBatch, this.rootBatchPageConfig());
      this.chunkSlotsDispatched += plans.length;
      if (plans.length === 0) continue;
      const slots = this.pool.prepare(plans);
      const countReadback = this.device.createBuffer({
        label: "gpu clod root count readback",
        size: slots.length * 2 * U32,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      try {
        const meshes = await this.dispatchAndReadSlots(slots, countReadback);
        nodes.push(...this.buildRootNodesFromMeshes(subBatch, slots, meshes));
      } finally {
        countReadback.destroy();
      }
    }
    return nodes;
  }

  private async dispatchAndReadSlots(
    slots: readonly GpuRootChunkSlot[],
    countReadback: GPUBuffer,
  ): Promise<Map<number, PageMesh>> {
    const encodeStart = performance.now();
    const encoder = this.device.createCommandEncoder({ label: "gpu clod root batch compute" });
    const vpass = encoder.beginComputePass();
    vpass.setPipeline(this.vertexPipeline);
    for (const slot of slots) {
      vpass.setBindGroup(0, slot.bindGroup);
      vpass.dispatchWorkgroups(Math.ceil(slot.dims.slotCount / WORKGROUP_SIZE));
    }
    vpass.end();
    const qpass = encoder.beginComputePass();
    qpass.setPipeline(this.quadPipeline);
    for (const slot of slots) {
      qpass.setBindGroup(0, slot.bindGroup);
      qpass.dispatchWorkgroups(Math.ceil((this.cfg.page.chunk_size * this.cfg.page.chunk_size * Y_CELLS * 3) / WORKGROUP_SIZE));
    }
    qpass.end();
    for (const slot of slots) {
      const offset = slot.slotIndex * 2 * U32;
      encoder.copyBufferToBuffer(this.pool.vertexCounts, slot.counterSlot * U32, countReadback, offset, U32);
      encoder.copyBufferToBuffer(this.pool.indexCounts, slot.counterSlot * U32, countReadback, offset + U32, U32);
    }
    this.device.queue.submit([encoder.finish()]);
    pushSample(this.encodeSubmitSamples, performance.now() - encodeStart);

    const countStart = performance.now();
    let mapped = false;
    let rawCounts = new Uint32Array(slots.length * 2);
    try {
      await countReadback.mapAsync(GPUMapMode.READ);
      mapped = true;
      rawCounts = new Uint32Array(countReadback.getMappedRange().slice(0));
    } finally {
      if (mapped) countReadback.unmap();
    }
    pushSample(this.countReadbackSamples, performance.now() - countStart);

    const counts = slots.map((slot) => {
      const vertexCount = rawCounts[slot.slotIndex * 2] ?? 0;
      const indexCount = rawCounts[slot.slotIndex * 2 + 1] ?? 0;
      if (vertexCount > slot.dims.maxVertices || indexCount > slot.dims.maxIndices) {
        throw new Error(`GPU streamed-root chunk count overflow at ${slot.cx},${slot.cz}: ${vertexCount}/${indexCount}`);
      }
      return { slotIndex: slot.slotIndex, vertexCount, indexCount };
    });
    return this.readGeometry(slots, counts);
  }

  private async readGeometry(
    slots: readonly GpuRootChunkSlot[],
    counts: readonly { slotIndex: number; vertexCount: number; indexCount: number }[],
  ): Promise<Map<number, PageMesh>> {
    const layout = planGeometryReadbackLayout(counts);
    this.assertReadbackLayout(layout);
    const offsets = {
      positions: 0,
      normals: layout.positionsBytes,
      materials: layout.positionsBytes + layout.normalsBytes,
      indices: layout.positionsBytes + layout.normalsBytes + layout.materialsBytes,
    };
    const totalBytes = offsets.indices + layout.indicesBytes;
    const readback = this.device.createBuffer({
      label: "gpu clod root rb geometry",
      size: Math.max(4, totalBytes),
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const slotsByIndex = new Map(slots.map((slot) => [slot.slotIndex, slot]));
    const geometryStart = performance.now();
    let mapped = false;
    try {
      const encoder = this.device.createCommandEncoder({ label: "gpu clod root batch readback" });
      for (const range of layout.ranges) {
        const slot = slotsByIndex.get(range.slotIndex);
        if (!slot || range.vertexCount === 0 || range.indexCount === 0) continue;
        encoder.copyBufferToBuffer(this.pool.positions, slot.positionOffsetBytes, readback, offsets.positions + range.positionsOffset, range.positionsBytes);
        encoder.copyBufferToBuffer(this.pool.normals, slot.normalOffsetBytes, readback, offsets.normals + range.normalsOffset, range.normalsBytes);
        encoder.copyBufferToBuffer(this.pool.materials, slot.materialOffsetBytes, readback, offsets.materials + range.materialsOffset, range.materialsBytes);
        encoder.copyBufferToBuffer(this.pool.indices, slot.indexOffsetBytes, readback, offsets.indices + range.indicesOffset, range.indicesBytes);
      }
      this.device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      mapped = true;
      const mappedRange = readback.getMappedRange();
      const meshes = new Map<number, PageMesh>();
      for (const range of layout.ranges) {
        if (range.vertexCount === 0 || range.indexCount === 0) {
          meshes.set(range.slotIndex, chunkMeshToPageMesh({
            positions: new Float32Array(0),
            normals: new Float32Array(0),
            materials: new Float32Array(0),
            indices: new Uint32Array(0),
          }));
          continue;
        }
        const chunk = assembleChunkMesh(
          f32Slice(mappedRange, offsets.positions + range.positionsOffset, range.positionsBytes),
          f32Slice(mappedRange, offsets.normals + range.normalsOffset, range.normalsBytes),
          f32Slice(mappedRange, offsets.materials + range.materialsOffset, range.materialsBytes),
          u32Slice(mappedRange, offsets.indices + range.indicesOffset, range.indicesBytes),
          range.vertexCount,
          range.indexCount,
        );
        meshes.set(range.slotIndex, chunkMeshToPageMesh(chunk));
      }
      return meshes;
    } finally {
      pushSample(this.geometryReadbackSamples, performance.now() - geometryStart);
      if (mapped) readback.unmap();
      readback.destroy();
    }
  }

  private assertReadbackLayout(layout: {
    positionsBytes: number;
    normalsBytes: number;
    materialsBytes: number;
    indicesBytes: number;
  }): void {
    assertBufferWithinLimit(layout.positionsBytes, this.batchLimits.maxReadbackBufferBytes, "gpu clod root rb positions");
    assertBufferWithinLimit(layout.normalsBytes, this.batchLimits.maxReadbackBufferBytes, "gpu clod root rb normals");
    assertBufferWithinLimit(layout.materialsBytes, this.batchLimits.maxReadbackBufferBytes, "gpu clod root rb materials");
    assertBufferWithinLimit(layout.indicesBytes, this.batchLimits.maxReadbackBufferBytes, "gpu clod root rb indices");
    assertBufferWithinLimit(
      layout.positionsBytes + layout.normalsBytes + layout.materialsBytes + layout.indicesBytes,
      this.batchLimits.maxReadbackBufferBytes,
      "gpu clod root rb geometry",
    );
  }

  private buildRootNodesFromMeshes(
    requests: readonly GpuClodRootBuildRequest[],
    slots: readonly GpuRootChunkSlot[],
    meshesBySlot: ReadonlyMap<number, PageMesh>,
  ): ClodPageNode[] {
    const P = this.cfg.page.chunks_per_page;
    const lod0Chunks = new Map<string, PageMesh[]>();
    for (const slot of slots) {
      const key = `${slot.lod0Px},${slot.lod0Pz}`;
      const chunks = lod0Chunks.get(key) ?? new Array<PageMesh>(P * P);
      const mesh = meshesBySlot.get(slot.slotIndex);
      if (!mesh) throw new Error(`GPU streamed-root chunk ${slot.slotIndex} was not read back`);
      this.assertChunkWithinCellBounds(mesh, slot);
      chunks[slot.localChunkIndex] = mesh;
      lod0Chunks.set(key, chunks);
    }
    const lod0Nodes = new Map<string, ClodPageNode>();
    for (const [coord, chunks] of lod0Chunks) {
      for (let index = 0; index < P * P; index++) {
        if (!chunks[index]) throw new Error(`GPU streamed-root L0:${coord} has missing chunk output`);
      }
      const [pxText, pzText] = coord.split(",");
      lod0Nodes.set(coord, buildLod0Page(Number(pxText), Number(pzText), chunks, this.cfg));
    }
    return requests.map((request) => this.buildRootPageFromLod0(request, lod0Nodes));
  }

  /**
   * Reject a GPU-produced chunk whose vertices leave its own cell box (a surface-nets chunk can only
   * place vertices ~1 cell beyond [x0,x1]x[z0,z1]). A vertex far outside is stale/garbage GPU pool
   * data — it renders as a stretched triangle. Throwing here is a soft failure that falls the batch
   * back to the (f64, watertight) CPU worker and names the exact slot so the GPU bug can be found.
   */
  private assertChunkWithinCellBounds(mesh: PageMesh, slot: GpuRootChunkSlot): void {
    const HALO = 2;
    const minX = slot.dims.x0 - HALO;
    const maxX = slot.dims.x1 + HALO;
    const minZ = slot.dims.z0 - HALO;
    const maxZ = slot.dims.z1 + HALO;
    const vc = mesh.positions.length / 3;
    const violation = findChunkVerticesOutOfBounds(mesh.positions, vc, minX, maxX, minZ, maxZ);
    if (!violation) return;
    throw new ClodBuildError(
      "GpuChunkOutOfBounds",
      `GPU chunk L0:${slot.lod0Px},${slot.lod0Pz} localChunk ${slot.localChunkIndex} ` +
        `(slot ${slot.slotIndex}, cx=${slot.cx},cz=${slot.cz}) emitted ${violation.outCount}/${vc} ` +
        `vertices outside cell bounds [${minX},${maxX}]x[${minZ},${maxZ}]; first at ` +
        `(${violation.x.toFixed(2)},${violation.y.toFixed(2)},${violation.z.toFixed(2)}) — ` +
        `stale GPU pool geometry, falling back to CPU`,
    );
  }

  private buildRootPageFromLod0(
    request: GpuClodRootBuildRequest,
    lod0Nodes: ReadonlyMap<string, ClodPageNode>,
  ): ClodPageNode {
    const rootLevel = Math.max(0, Math.min(this.cfg.page.quadtree_levels - 1, Math.floor(request.level ?? 0)));
    const index: Map<string, ClodPageNode>[] = [];
    const lod0Index = new Map<string, ClodPageNode>();
    const lod0Scale = 2 ** rootLevel;
    const lod0BaseX = request.px * lod0Scale;
    const lod0BaseZ = request.pz * lod0Scale;
    for (let pz = lod0BaseZ; pz < lod0BaseZ + lod0Scale; pz++) {
      for (let px = lod0BaseX; px < lod0BaseX + lod0Scale; px++) {
        const node = lod0Nodes.get(`${px},${pz}`);
        if (!node) throw new Error(`streamed GPU root missing L0:${px},${pz}`);
        lod0Index.set(`${px},${pz}`, node);
      }
    }
    index[0] = lod0Index;
    for (let currentLevel = 1; currentLevel <= rootLevel; currentLevel++) {
      const scale = 2 ** (rootLevel - currentLevel);
      const baseX = request.px * scale;
      const baseZ = request.pz * scale;
      const levelIndex = new Map<string, ClodPageNode>();
      for (let pz = baseZ; pz < baseZ + scale; pz++) {
        for (let px = baseX; px < baseX + scale; px++) {
          levelIndex.set(`${px},${pz}`, buildParentNode(currentLevel, px, pz, childNodes(index, currentLevel, px, pz), this.cfg));
        }
      }
      index[currentLevel] = levelIndex;
    }
    const root = index[rootLevel]?.get(`${request.px},${request.pz}`);
    if (!root) throw new Error(`streamed GPU root L${rootLevel}:${request.px},${request.pz} was not built`);
    root.children = [];
    return root;
  }
}

function tileAtlasMesherRequested(): boolean {
  const search = (globalThis as typeof globalThis & { window?: { location?: { search?: string } } }).window?.location?.search ?? "";
  return continentTileMeshingEnabled(new URLSearchParams(search));
}

export function terrainFieldShaderWithTileAtlas(): string {
  const procedural = composeTerrainFieldShader()
    .replace(
      "fn surfaceHeightField(x : f32, z : f32) -> f32 {",
      "fn proceduralSurfaceHeightField(x : f32, z : f32) -> f32 {",
    )
    .replace(
      "let nrm = densityGradient(p.x, p.y, p.z);",
      "let nrm = densityGradient(continentStableNormalCoordinate(p.x), continentStableNormalCoordinate(p.y), continentStableNormalCoordinate(p.z));",
    );
  return `${procedural}
@group(0) @binding(10) var continentHeightAtlas : texture_2d<f32>;
@group(0) @binding(11) var<uniform> continentHeightAtlasParams : vec4<f32>;

fn continentPositiveMod(value : i32, divisor : i32) -> i32 {
  return ((value % divisor) + divisor) % divisor;
}

// Adjacent surface-net chunks can differ by one f32 ULP at an otherwise shared
// vertex. Snap only the finite-difference probe in atlas mode so the nearest-
// lattice lookup cannot select opposite sides of a half-cell boundary.
fn continentStableNormalCoordinate(value : f32) -> f32 {
  if (continentHeightAtlasParams.w < 0.5) { return value; }
  return floor(value * 64.0 + 0.5) / 64.0;
}

fn surfaceHeightField(x : f32, z : f32) -> f32 {
  if (continentHeightAtlasParams.w < 0.5) {
    return proceduralSurfaceHeightField(x, z);
  }
  let tileSize = continentHeightAtlasParams.x;
  let tileRes = i32(continentHeightAtlasParams.y);
  let tilesPerSide = i32(continentHeightAtlasParams.z);
  let tileX = i32(floor(x / tileSize));
  let tileZ = i32(floor(z / tileSize));
  let localX = clamp(i32(round(x - f32(tileX) * tileSize)), 0, tileRes - 1);
  let localZ = clamp(i32(round(z - f32(tileZ) * tileSize)), 0, tileRes - 1);
  let slotX = continentPositiveMod(tileX, tilesPerSide);
  let slotZ = continentPositiveMod(tileZ, tilesPerSide);
  return textureLoad(continentHeightAtlas, vec2<i32>(slotX * tileRes + localX, slotZ * tileRes + localZ), 0).x;
}
`;
}

function createHeightAtlasBindings(device: GPUDevice): HeightAtlasBindings {
  const active = tileAtlasMesherRequested() ? createHeightfieldTileGpuAtlas(device) : null;
  if (active) return { view: active.view, params: active.params };
  const texture = device.createTexture({
    label: "continent heightfield tile atlas disabled",
    size: { width: 1, height: 1 },
    format: "r32float",
    usage: GPUTextureUsage.TEXTURE_BINDING,
  });
  const params = device.createBuffer({
    label: "continent heightfield tile atlas disabled params",
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(params, 0, new Float32Array([1, 1, 1, 0]));
  return { view: texture.createView(), params, dispose: () => { texture.destroy(); params.destroy(); } };
}

export async function createGpuClodRootMesher(opts: CreateGpuClodRootMesherOptions): Promise<GpuClodRootMesher | null> {
  let device = opts.sharedDevice ?? null;
  try {
    if (!device) {
      const result = await requestWebGpuDevice();
      if (!result.ok) throw new Error(result.message ?? result.reason);
      device = result.device;
    }
    const module = device.createShaderModule({ label: "gpu clod root mesher shader", code: terrainFieldShaderWithTileAtlas() });
    const heightAtlas = createHeightAtlasBindings(device);
    const storage = (i: number): GPUBindGroupLayoutEntry => ({
      binding: i,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: "storage" },
    });
    const layout = device.createBindGroupLayout({
      label: "gpu clod root mesher layout",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        storage(3),
        storage(4),
        storage(5),
        storage(6),
        storage(7),
        storage(8),
        storage(9),
        { binding: 10, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "unfilterable-float" } },
        { binding: 11, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      ],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const [vertexPipeline, quadPipeline] = await Promise.all([
      device.createComputePipelineAsync({
        label: "gpu clod root mesher vertexPass",
        layout: pipelineLayout,
        compute: { module, entryPoint: "vertexPass" },
      }),
      device.createComputePipelineAsync({
        label: "gpu clod root mesher quadPass",
        layout: pipelineLayout,
        compute: { module, entryPoint: "quadPass" },
      }),
    ]);
    const mesher = new BatchedGpuClodRootMesher(device, layout, vertexPipeline, quadPipeline, opts.cfg, opts.world, opts.config, heightAtlas);
    publishGpuClodRootMesherCounters(mesher.stats());
    return mesher;
  } catch (error) {
    console.warn("[clod-stream-gpu] WebGPU streamed-root mesher unavailable; using CPU worker fallback", error);
    publishGpuClodRootMesherCounters(disabledGpuStats());
    return null;
  }
}

export function publishGpuClodRootMesherCounters(stats: GpuClodRootMesherStats): void {
  const counters = (globalThis as typeof globalThis & {
    window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
  }).window?.__drusnielClod?.stats?.counters;
  if (!counters) return;
  counters["live_clod_stream_gpu_mesher_enabled"] = stats.enabled;
  counters["live_clod_stream_gpu_batches_dispatched"] = stats.batchesDispatched;
  counters["live_clod_stream_gpu_pages_dispatched"] = stats.pagesDispatched;
  counters["live_clod_stream_gpu_batch_pages_p95"] = stats.batchPagesP95;
  counters["live_clod_stream_gpu_chunk_slots_dispatched"] = stats.chunkSlotsDispatched;
  counters["live_clod_stream_gpu_encode_submit_ms_p50"] = stats.encodeSubmitMsP50;
  counters["live_clod_stream_gpu_encode_submit_ms_p95"] = stats.encodeSubmitMsP95;
  counters["live_clod_stream_gpu_compute_submit_ms_p50"] = stats.encodeSubmitMsP50;
  counters["live_clod_stream_gpu_compute_submit_ms_p95"] = stats.encodeSubmitMsP95;
  counters["live_clod_stream_gpu_count_readback_ms_p95"] = stats.countReadbackMsP95;
  counters["live_clod_stream_gpu_geometry_readback_ms_p95"] = stats.geometryReadbackMsP95;
  counters["live_clod_stream_gpu_build_ms_p50"] = stats.buildMsP50;
  counters["live_clod_stream_gpu_build_ms_p95"] = stats.buildMsP95;
  counters["live_clod_stream_gpu_build_ms_max"] = stats.buildMsMax;
  counters["live_clod_stream_gpu_readback_ms_p95"] = stats.readbackMsP95;
  counters["live_clod_stream_gpu_fallback_pages"] = stats.fallbackPages;
  counters["live_clod_stream_gpu_failed_batches"] = stats.failedBatches;
  counters["live_clod_stream_worker_fallback_pages"] = stats.workerFallbackPages;
}

export function disabledGpuStats(workerFallbackPages = 0): GpuClodRootMesherStats {
  return {
    enabled: 0,
    batchesDispatched: 0,
    pagesDispatched: 0,
    batchPagesP95: 0,
    chunkSlotsDispatched: 0,
    encodeSubmitMsP50: 0,
    encodeSubmitMsP95: 0,
    countReadbackMsP95: 0,
    geometryReadbackMsP95: 0,
    buildMsP50: 0,
    buildMsP95: 0,
    buildMsMax: 0,
    readbackMsP95: 0,
    fallbackPages: 0,
    failedBatches: 0,
    workerFallbackPages,
  };
}

function resolveRuntimeBatchLimits(device: GPUDevice, config: StreamingRootGpuMesherConfig, chunkSize: number): RuntimeBatchLimits {
  const maxBufferSize = positiveLimit((device.limits as { maxBufferSize?: number }).maxBufferSize, DEFAULT_MAX_READBACK_BUFFER_BYTES);
  const maxStorageBufferBindingSize = positiveLimit(
    (device.limits as { maxStorageBufferBindingSize?: number }).maxStorageBufferBindingSize,
    maxBufferSize,
  );
  const dims = computeMeshDims(0, 0, Math.max(1, Math.floor(chunkSize)));
  const maxSingleStorageBufferBytes = Math.max(
    dims.maxVertices * 3 * F32,
    dims.maxVertices * F32,
    dims.slotCount * U32,
    dims.maxIndices * U32,
    U32,
  );
  const maxSingleGroupedReadbackBytes = Math.max(dims.maxVertices * 3 * F32, dims.maxVertices * F32, dims.maxIndices * U32);
  const deviceReadbackBudget = Math.max(4, Math.floor(maxBufferSize * READBACK_BUFFER_HEADROOM));
  const maxReadbackBufferBytes = Math.max(4, Math.min(deviceReadbackBudget, positiveLimit(config.maxReadbackBufferBytes, deviceReadbackBudget)));
  const readbackSlotLimit = Math.max(1, Math.floor(maxReadbackBufferBytes / Math.max(1, maxSingleGroupedReadbackBytes)));
  const storageSlotLimit = Math.max(1, Math.floor(maxStorageBufferBindingSize / Math.max(1, maxSingleStorageBufferBytes)));
  const configuredChunkSlots = positiveLimit(config.maxChunkSlots, DEFAULT_MAX_BATCH_CHUNK_SLOTS);
  const maxChunkSlots = Math.max(1, Math.min(DEFAULT_MAX_BATCH_CHUNK_SLOTS, configuredChunkSlots, readbackSlotLimit, storageSlotLimit));
  const chunkEstimate = estimateChunkSlotBytes(chunkSize).totalBytes;
  const deviceTotalBudget = Math.max(chunkEstimate, Math.min(DEFAULT_MAX_TOTAL_SLOT_BYTES, Math.floor(maxBufferSize * TOTAL_SLOT_BUFFER_HEADROOM)));
  const totalBudget = Math.max(chunkEstimate, Math.min(deviceTotalBudget, positiveLimit(config.maxTotalSlotBytes, deviceTotalBudget)));
  return {
    batchSize: Math.max(1, Math.floor(config.batchSize)),
    maxChunkSlots,
    maxTotalSlotBytes: totalBudget,
    maxReadbackBufferBytes,
  };
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function assertBufferWithinLimit(size: number, limit: number, label: string): void {
  if (size <= limit) return;
  throw new RootGpuBatchLimitError(
    `${label} requires ${size} bytes, above WebGPU-safe limit ${limit}`,
    { px: 0, pz: 0 },
    0,
    size,
    { batchSize: 1, maxChunkSlots: 1, maxTotalSlotBytes: limit, maxReadbackBufferBytes: limit },
  );
}

function isHardGpuFailure(error: unknown): boolean {
  if (error instanceof RootGpuBatchLimitError) return false;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /out.?of.?memory|device.?lost|validation|maxBufferSize|GPUValidationError|OperationError/i.test(message);
}

function f32Slice(buffer: ArrayBuffer, byteOffset: number, byteLength: number): Float32Array {
  return new Float32Array(buffer.slice(byteOffset, byteOffset + byteLength));
}

function u32Slice(buffer: ArrayBuffer, byteOffset: number, byteLength: number): Uint32Array {
  return new Uint32Array(buffer.slice(byteOffset, byteOffset + byteLength));
}

function buildLod0Page(px: number, pz: number, chunkMeshes: readonly PageMesh[], cfg: ClodPagesConfig): ClodPageNode {
  const mesh = weldChunkMeshes(chunkMeshes, cfg);
  const footprint = footprintFor(0, px, pz, cfg);
  const nodeId = `L0:${px},${pz}`;
  validatePageMesh(mesh, footprint, cfg.validation.zero_area_epsilon, nodeId);
  return {
    id: nodeId,
    revision: INITIAL_NODE_REVISION,
    level: 0,
    children: [],
    mesh,
    footprint,
    bounds: boundsOf(mesh),
    errorWorld: 0,
    lowBenefit: false,
    chunkMeshes: [...chunkMeshes],
  };
}

function chunkMeshToPageMesh(mesh: ChunkMesh): PageMesh {
  const vertexTotal = mesh.positions.length / 3;
  const materialWeightStride = mesh.materialWeightStride ?? DEFAULT_MATERIAL_WEIGHT_STRIDE;
  const materialWeights = mesh.materialWeights?.length === vertexTotal * materialWeightStride
    ? mesh.materialWeights
    : oneHotMaterialWeights(mesh.materials, vertexTotal, materialWeightStride);
  return {
    positions: mesh.positions,
    normals: mesh.normals,
    paintSlots: mesh.materials.length === vertexTotal ? mesh.materials : new Float32Array(vertexTotal),
    materialWeights,
    materialWeightStride,
    indices: mesh.indices,
  };
}

function oneHotMaterialWeights(materials: Float32Array, vertexTotal: number, stride: number): Float32Array {
  const weights = new Float32Array(vertexTotal * stride);
  for (let vertex = 0; vertex < vertexTotal; vertex++) {
    weights[vertex * stride + Math.max(0, Math.min(stride - 1, Math.floor(materials[vertex] ?? 0)))] = 1;
  }
  return weights;
}

function weldChunkMeshes(chunks: readonly PageMesh[], cfg: ClodPagesConfig): PageMesh {
  const sections: PageSourceSection[] = chunks.map((mesh, index) => ({
    kind: "mainTerrain",
    terrainClass: "inland",
    positionSource: "extracted",
    label: `gpu-chunk-${index}`,
    mesh,
  }));
  const filtered = filterPageSourceSections(sections);
  return weldVertices(filtered.mesh, cfg.simplify.weld_epsilon_cells, {
    position: cfg.validation.position_epsilon,
    normalDot: cfg.validation.normal_dot_min,
    material: cfg.validation.material_weight_epsilon,
  }).mesh;
}

function buildParentNode(level: number, nx: number, nz: number, children: readonly ClodPageNode[], cfg: ClodPagesConfig): ClodPageNode {
  requireFourChildren(level, nx, nz, children);
  const merged = concatPageSourceMeshes(children.map((child) => child.mesh));
  const { mesh: welded } = weldVertices(merged, cfg.simplify.weld_epsilon_cells, {
    position: cfg.validation.position_epsilon,
    normalDot: cfg.validation.normal_dot_min,
    material: cfg.validation.material_weight_epsilon,
  });
  const footprint = footprintFor(level, nx, nz, cfg);
  validateWeldedIntermediate(welded, `L${level}:${nx},${nz} gpu welded`, cfg.validation.zero_area_epsilon);
  const locks = buildOuterBorderLocks(welded);
  let mesh = welded;
  let errorWorld = 0;
  let lowBenefit = true;
  try {
    const simplified = simplifyPage(clonePageMesh(welded), locks, cfg);
    stripDegenerateTriangles(simplified.mesh, cfg.validation.zero_area_epsilon);
    assertNoInternalBorders(simplified.mesh, footprint, `L${level}:${nx},${nz} gpu simplified`);
    mesh = simplified.mesh;
    errorWorld = simplified.errorWorld;
    lowBenefit = simplified.lowBenefit;
  } catch {
    validateFinalPageMesh(welded, footprint, cfg.validation.zero_area_epsilon, `L${level}:${nx},${nz} gpu welded fallback`);
  }
  return {
    id: `L${level}:${nx},${nz}`,
    revision: INITIAL_NODE_REVISION,
    level,
    children: [...children],
    mesh,
    footprint,
    bounds: boundsOf(mesh),
    errorWorld: errorWorld + Math.max(...children.map((child) => child.errorWorld)),
    lowBenefit,
  };
}

function childNodes(index: Map<string, ClodPageNode>[], level: number, nx: number, nz: number): ClodPageNode[] {
  const children: ClodPageNode[] = [];
  for (let dz = 0; dz < 2; dz++) {
    for (let dx = 0; dx < 2; dx++) {
      const child = index[level - 1]?.get(`${nx * 2 + dx},${nz * 2 + dz}`);
      if (child) children.push(child);
    }
  }
  requireFourChildren(level, nx, nz, children);
  return children;
}

function transferBytesForNode(node: ClodPageNode): number {
  return node.mesh.positions.byteLength
    + node.mesh.normals.byteLength
    + node.mesh.paintSlots.byteLength
    + node.mesh.materialWeights.byteLength
    + node.mesh.indices.byteLength;
}

function pushSample(samples: number[], value: number): void {
  if (!Number.isFinite(value)) return;
  samples.push(Math.max(0, value));
  if (samples.length > STREAM_COUNTER_SAMPLE_LIMIT) samples.shift();
}

function percentile(values: readonly number[], percentileRank: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * percentileRank))] ?? 0;
}
