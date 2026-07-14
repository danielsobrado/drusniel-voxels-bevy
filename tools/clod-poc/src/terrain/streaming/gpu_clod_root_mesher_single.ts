import type { ClodPagesConfig } from "../../config.js";
import { initSimplifier } from "../../clod/meshopt.js";
import { buildParentNode } from "../../clod/quadtree.js";
import { childNodes, footprintFor, INITIAL_NODE_REVISION } from "../../clod/quadtree_support.js";
import { validatePageMesh } from "../../clod/validate.js";
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
import { composeTerrainFieldShader } from "../../gpu/shader_source.js";
import type { ClodPageNode, PageMesh } from "../../types.js";
import { createHeightfieldTileGpuAtlas } from "../../world/heightfield_tiles/heightfield_tile_gpu_atlas.js";
import { continentTileMeshingEnabled } from "./streamed_root_gpu_config.js";
import {
  estimateChunkSlotBytes,
  estimateRootRequestReadbackBytes,
  estimateRootRequestSlotBytes,
  planRootBatchChunkSlots,
  RootGpuBatchLimitError,
  type GpuRootChunkPlan,
  type RootBatchPageConfig,
  type RootGpuBatchLimits,
} from "./gpu_clod_root_batch_buffers.js";
import type { StreamingRootGpuMesherConfig } from "./streamed_root_gpu_config.js";
import type { WorldBounds } from "../terrain_surface.js";

const F32 = Float32Array.BYTES_PER_ELEMENT;
const U32 = Uint32Array.BYTES_PER_ELEMENT;
const DEFAULT_MAX_BATCH_CHUNK_SLOTS = 64;
const DEFAULT_MAX_TOTAL_SLOT_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_READBACK_BUFFER_BYTES = 256 * 1024 * 1024;
const READBACK_BUFFER_HEADROOM = 0.75;
const TOTAL_SLOT_BUFFER_HEADROOM = 2;
const STORAGE = (extra = 0) => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | extra;
const DEFAULT_MATERIAL_WEIGHT_STRIDE = 4;
const SAMPLE_LIMIT = 128;

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
      if (isHardGpuClodFailure(error)) this.disabledError = error instanceof Error ? error : new Error(String(error));
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

  private async buildOversizedRootFromLod0(
    request: GpuClodRootBuildRequest,
    rootLevel: number,
  ): Promise<ClodPageNode> {
    const scale = 2 ** rootLevel;
    const lod0Requests: GpuClodRootBuildRequest[] = [];
    for (let dz = 0; dz < scale; dz++) {
      for (let dx = 0; dx < scale; dx++) {
        lod0Requests.push({ px: request.px * scale + dx, pz: request.pz * scale + dz, level: 0 });
      }
    }
    const lod0Nodes = new Map<string, ClodPageNode>();
    for (const subBatch of this.partitionRequestsForGpu(lod0Requests)) {
      for (const node of await this.buildRootSubBatch(subBatch)) {
        lod0Nodes.set(`${node.footprint.minX},${node.footprint.minZ}`, node);
      }
    }
    return this.buildRootPageFromLod0(request, lod0Nodes);
  }

  private partitionRequestsForGpu(
    requests: readonly GpuClodRootBuildRequest[],
  ): GpuClodRootBuildRequest[][] {
    const result: GpuClodRootBuildRequest[][] = [];
    let current: GpuClodRootBuildRequest[] = [];
    let currentSlots = 0;
    let currentBytes = 0;
    let currentReadbackBytes = 0;
    for (const request of requests) {
      const slots = chunkSlotsPerRootPage(this.cfg.page.chunks_per_page, 0);
      const bytes = estimateRootRequestSlotBytes(request, this.rootBatchPageConfig());
      const readbackBytes = estimateRootRequestReadbackBytes(request, this.rootBatchPageConfig());
      const wouldOverflow = current.length > 0 && (
        currentSlots + slots > this.batchLimits.maxChunkSlots
        || currentBytes + bytes > this.batchLimits.maxTotalSlotBytes
        || currentReadbackBytes + readbackBytes > this.batchLimits.maxReadbackBufferBytes
        || current.length >= this.batchLimits.batchSize
      );
      if (wouldOverflow) {
        result.push(current);
        current = [];
        currentSlots = 0;
        currentBytes = 0;
        currentReadbackBytes = 0;
      }
      current.push(request);
      currentSlots += slots;
      currentBytes += bytes;
      currentReadbackBytes += readbackBytes;
    }
    if (current.length > 0) result.push(current);
    return result;
  }

  private async buildRootSubBatch(batch: readonly GpuClodRootBuildRequest[]): Promise<ClodPageNode[]> {
    if (batch.length === 0) return [];
    const plans = planRootBatchChunkSlots(batch, this.rootBatchPageConfig());
    this.batchesDispatched++;
    this.chunkSlotsDispatched += plans.length;
    pushSample(this.batchPageSamples, batch.length);
    const slots = this.pool.prepare(plans);
    const counts = await this.dispatchAndReadCounts(slots);
    const meshesBySlot = await this.readbackGeometry(slots, counts);
    return this.buildRootNodesFromMeshes(batch, slots, meshesBySlot);
  }

  private async dispatchAndReadCounts(
    slots: readonly GpuRootChunkSlot[],
  ): Promise<Map<number, { vertexCount: number; indexCount: number }>> {
    const countReadback = this.device.createBuffer({
      label: "gpu clod root count readback",
      size: Math.max(4, slots.length * 2 * U32),
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const encodeStartedAt = performance.now();
    const encoder = this.device.createCommandEncoder({ label: "gpu clod root compute" });
    const vertexPass = encoder.beginComputePass();
    vertexPass.setPipeline(this.vertexPipeline);
    for (const slot of slots) {
      vertexPass.setBindGroup(0, slot.bindGroup);
      vertexPass.dispatchWorkgroups(Math.ceil(slot.dims.slotCount / 64));
    }
    vertexPass.end();
    const quadPass = encoder.beginComputePass();
    quadPass.setPipeline(this.quadPipeline);
    for (const slot of slots) {
      quadPass.setBindGroup(0, slot.bindGroup);
      quadPass.dispatchWorkgroups(
        Math.ceil((this.cfg.page.chunk_size * this.cfg.page.chunk_size * Y_CELLS * 3) / 64),
      );
    }
    quadPass.end();
    for (let index = 0; index < slots.length; index++) {
      const slot = slots[index]!;
      encoder.copyBufferToBuffer(
        this.pool.vertexCounts,
        slot.counterSlot * U32,
        countReadback,
        index * 2 * U32,
        U32,
      );
      encoder.copyBufferToBuffer(
        this.pool.indexCounts,
        slot.counterSlot * U32,
        countReadback,
        index * 2 * U32 + U32,
        U32,
      );
    }
    this.device.queue.submit([encoder.finish()]);
    pushSample(this.encodeSubmitSamples, performance.now() - encodeStartedAt);

    const readStartedAt = performance.now();
    let mapped = false;
    try {
      await countReadback.mapAsync(GPUMapMode.READ);
      mapped = true;
      const countValues = new Uint32Array(countReadback.getMappedRange().slice(0));
      const counts = new Map<number, { vertexCount: number; indexCount: number }>();
      for (let index = 0; index < slots.length; index++) {
        const slot = slots[index]!;
        const vertexCount = countValues[index * 2] ?? 0;
        const indexCount = countValues[index * 2 + 1] ?? 0;
        if (vertexCount > slot.dims.maxVertices || indexCount > slot.dims.maxIndices) {
          throw new Error(
            `GPU streamed-root count overflow for slot ${slot.slotIndex}: ${vertexCount}/${indexCount} `
            + `above ${slot.dims.maxVertices}/${slot.dims.maxIndices}`,
          );
        }
        counts.set(slot.slotIndex, { vertexCount, indexCount });
      }
      return counts;
    } finally {
      pushSample(this.countReadbackSamples, performance.now() - readStartedAt);
      if (mapped) countReadback.unmap();
      countReadback.destroy();
    }
  }

  private async readbackGeometry(
    slots: readonly GpuRootChunkSlot[],
    counts: ReadonlyMap<number, { vertexCount: number; indexCount: number }>,
  ): Promise<Map<number, ChunkMesh>> {
    const groups = planGeometryReadbackGroups(slots, counts, this.batchLimits.maxReadbackBufferBytes);
    const result = new Map<number, ChunkMesh>();
    for (const group of groups) {
      const positionBytes = group.reduce((sum, item) => sum + item.vertexCount * 3 * F32, 0);
      const normalBytes = positionBytes;
      const materialBytes = group.reduce((sum, item) => sum + item.vertexCount * F32, 0);
      const indexBytes = group.reduce((sum, item) => sum + item.indexCount * U32, 0);
      assertBufferWithinLimit(positionBytes, this.batchLimits.maxReadbackBufferBytes, "position readback group");
      assertBufferWithinLimit(normalBytes, this.batchLimits.maxReadbackBufferBytes, "normal readback group");
      assertBufferWithinLimit(materialBytes, this.batchLimits.maxReadbackBufferBytes, "material readback group");
      assertBufferWithinLimit(indexBytes, this.batchLimits.maxReadbackBufferBytes, "index readback group");
      const positionReadback = this.device.createBuffer({
        label: "gpu clod root position readback",
        size: Math.max(4, positionBytes),
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      const normalReadback = this.device.createBuffer({
        label: "gpu clod root normal readback",
        size: Math.max(4, normalBytes),
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      const materialReadback = this.device.createBuffer({
        label: "gpu clod root material readback",
        size: Math.max(4, materialBytes),
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      const indexReadback = this.device.createBuffer({
        label: "gpu clod root index readback",
        size: Math.max(4, indexBytes),
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      const encoder = this.device.createCommandEncoder({ label: "gpu clod root geometry readback" });
      let positionOffset = 0;
      let normalOffset = 0;
      let materialOffset = 0;
      let indexOffset = 0;
      for (const item of group) {
        if (item.vertexCount > 0) {
          encoder.copyBufferToBuffer(this.pool.positions, item.slot.positionOffsetBytes, positionReadback, positionOffset, item.vertexCount * 3 * F32);
          encoder.copyBufferToBuffer(this.pool.normals, item.slot.normalOffsetBytes, normalReadback, normalOffset, item.vertexCount * 3 * F32);
          encoder.copyBufferToBuffer(this.pool.materials, item.slot.materialOffsetBytes, materialReadback, materialOffset, item.vertexCount * F32);
        }
        if (item.indexCount > 0) encoder.copyBufferToBuffer(this.pool.indices, item.slot.indexOffsetBytes, indexReadback, indexOffset, item.indexCount * U32);
        positionOffset += item.vertexCount * 3 * F32;
        normalOffset += item.vertexCount * 3 * F32;
        materialOffset += item.vertexCount * F32;
        indexOffset += item.indexCount * U32;
      }
      this.device.queue.submit([encoder.finish()]);
      const readStartedAt = performance.now();
      let mappedPosition = false;
      let mappedNormal = false;
      let mappedMaterial = false;
      let mappedIndex = false;
      try {
        await Promise.all([
          positionReadback.mapAsync(GPUMapMode.READ).then(() => { mappedPosition = true; }),
          normalReadback.mapAsync(GPUMapMode.READ).then(() => { mappedNormal = true; }),
          materialReadback.mapAsync(GPUMapMode.READ).then(() => { mappedMaterial = true; }),
          indexReadback.mapAsync(GPUMapMode.READ).then(() => { mappedIndex = true; }),
        ]);
        positionOffset = 0;
        normalOffset = 0;
        materialOffset = 0;
        indexOffset = 0;
        for (const item of group) {
          const positions = f32Slice(positionReadback.getMappedRange(), positionOffset, item.vertexCount * 3 * F32);
          const normals = f32Slice(normalReadback.getMappedRange(), normalOffset, item.vertexCount * 3 * F32);
          const materials = f32Slice(materialReadback.getMappedRange(), materialOffset, item.vertexCount * F32);
          const indices = u32Slice(indexReadback.getMappedRange(), indexOffset, item.indexCount * U32);
          result.set(item.slot.slotIndex, { positions, normals, materials, indices });
          positionOffset += item.vertexCount * 3 * F32;
          normalOffset += item.vertexCount * 3 * F32;
          materialOffset += item.vertexCount * F32;
          indexOffset += item.indexCount * U32;
        }
      } finally {
        pushSample(this.geometryReadbackSamples, performance.now() - readStartedAt);
        if (mappedPosition) positionReadback.unmap();
        if (mappedNormal) normalReadback.unmap();
        if (mappedMaterial) materialReadback.unmap();
        if (mappedIndex) indexReadback.unmap();
        positionReadback.destroy();
        normalReadback.destroy();
        materialReadback.destroy();
        indexReadback.destroy();
      }
    }
    return result;
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

  private assertChunkWithinCellBounds(mesh: PageMesh, slot: GpuRootChunkSlot): void {
    const HALO = 2;
    const minX = slot.dims.x0 - HALO;
    const maxX = slot.dims.x1 + HALO;
    const minZ = slot.dims.z0 - HALO;
    const maxZ = slot.dims.z1 + HALO;
    const vc = mesh.positions.length / 3;
    const violation = findChunkVerticesOutOfBounds(mesh.positions, vc, minX, maxX, minZ, maxZ);
    if (!violation) return;
    throw new Error(
      `GPU chunk L0:${slot.lod0Px},${slot.lod0Pz} localChunk ${slot.localChunkIndex} `
      + `(slot ${slot.slotIndex}, cx=${slot.cx},cz=${slot.cz}) emitted ${violation.outCount}/${vc} `
      + `vertices outside cell bounds [${minX},${maxX}]x[${minZ},${maxZ}]; first at `
      + `(${violation.x.toFixed(2)},${violation.y.toFixed(2)},${violation.z.toFixed(2)}) — `
      + `stale GPU pool geometry, falling back to CPU`,
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
        storage(3), storage(4), storage(5), storage(6), storage(7), storage(8), storage(9),
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

export function isHardGpuClodFailure(error: unknown): boolean {
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

function transferBytesForNode(node: ClodPageNode): number {
  return node.mesh.positions.byteLength
    + node.mesh.normals.byteLength
    + node.mesh.paintSlots.byteLength
    + node.mesh.materialWeights.byteLength
    + node.mesh.indices.byteLength;
}

function rootLevelForRequest(request: GpuClodRootBuildRequest, cfg: RootBatchPageConfig): number {
  return Math.max(0, Math.min(cfg.quadtree_levels - 1, Math.floor(request.level ?? 0)));
}

function chunkSlotsPerRootPage(chunksPerPage: number, level: number): number {
  return (chunksPerPage * 2 ** level) ** 2;
}

function findChunkVerticesOutOfBounds(
  positions: Float32Array,
  vertexCount: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): { outCount: number; x: number; y: number; z: number } | null {
  let outCount = 0;
  let firstX = 0;
  let firstY = 0;
  let firstZ = 0;
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const offset = vertex * 3;
    const x = positions[offset] ?? 0;
    const y = positions[offset + 1] ?? 0;
    const z = positions[offset + 2] ?? 0;
    if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) continue;
    if (outCount === 0) {
      firstX = x;
      firstY = y;
      firstZ = z;
    }
    outCount++;
  }
  return outCount > 0 ? { outCount, x: firstX, y: firstY, z: firstZ } : null;
}

function planGeometryReadbackGroups(
  slots: readonly GpuRootChunkSlot[],
  counts: ReadonlyMap<number, { vertexCount: number; indexCount: number }>,
  maxBytes: number,
): Array<Array<{ slot: GpuRootChunkSlot; vertexCount: number; indexCount: number }>> {
  const groups: Array<Array<{ slot: GpuRootChunkSlot; vertexCount: number; indexCount: number }>> = [];
  let current: Array<{ slot: GpuRootChunkSlot; vertexCount: number; indexCount: number }> = [];
  let positionBytes = 0;
  let materialBytes = 0;
  let indexBytes = 0;
  for (const slot of slots) {
    const count = counts.get(slot.slotIndex);
    if (!count) throw new Error(`GPU streamed-root slot ${slot.slotIndex} has no count result`);
    const nextPositionBytes = positionBytes + count.vertexCount * 3 * F32;
    const nextMaterialBytes = materialBytes + count.vertexCount * F32;
    const nextIndexBytes = indexBytes + count.indexCount * U32;
    if (current.length > 0 && Math.max(nextPositionBytes, nextMaterialBytes, nextIndexBytes) > maxBytes) {
      groups.push(current);
      current = [];
      positionBytes = 0;
      materialBytes = 0;
      indexBytes = 0;
    }
    current.push({ slot, vertexCount: count.vertexCount, indexCount: count.indexCount });
    positionBytes += count.vertexCount * 3 * F32;
    materialBytes += count.vertexCount * F32;
    indexBytes += count.indexCount * U32;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))] ?? 0;
}

function pushSample(samples: number[], value: number): void {
  samples.push(value);
  if (samples.length > SAMPLE_LIMIT) samples.shift();
}
