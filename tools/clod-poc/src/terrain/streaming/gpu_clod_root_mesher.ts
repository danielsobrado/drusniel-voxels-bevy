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
import type { ClodPageNode, PageMesh } from "../../types.js";
import type { WorldBounds } from "../terrain_surface.js";
import {
  RootGpuBatchLimitError,
  estimateChunkSlotBytes,
  estimateRootRequestSlotBytes,
  planGeometryReadbackLayout,
  planRootBatchChunkSlots,
  splitRootGpuBatches,
  type GpuRootChunkPlan,
  type RootGpuBatchLimits,
  type RootBatchPageConfig,
} from "./gpu_clod_root_batch_buffers.js";
import type { StreamingRootGpuMesherConfig } from "./streamed_root_gpu_config.js";

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
  meshParams: GPUBuffer;
  outPositions: GPUBuffer;
  outNormals: GPUBuffer;
  outMaterials: GPUBuffer;
  cellIndex: GPUBuffer;
  outIndices: GPUBuffer;
  indexCount: GPUBuffer;
  vertexCount: GPUBuffer;
  bindGroup: GPUBindGroup;
}

interface RuntimeBatchLimits extends RootGpuBatchLimits {
  maxReadbackBufferBytes: number;
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

  constructor(
    private readonly device: GPUDevice,
    private readonly layout: GPUBindGroupLayout,
    private readonly vertexPipeline: GPUComputePipeline,
    private readonly quadPipeline: GPUComputePipeline,
    private readonly cfg: ClodPagesConfig,
    private readonly world: WorldBounds,
    private readonly config: StreamingRootGpuMesherConfig,
  ) {
    this.batchLimits = resolveRuntimeBatchLimits(device, config, cfg.page.chunk_size);
  }

  async buildPages(batch: readonly GpuClodRootBuildRequest[]): Promise<GpuClodRootBuildResult> {
    if (batch.length === 0) return { nodes: [], buildMs: 0, transferBytes: 0 };
    if (this.disabledError) throw this.disabledError;
    const startedAt = performance.now();
    const nodes: ClodPageNode[] = [];
    const batchCfg = this.rootBatchPageConfig();
    const subBatches = splitRootGpuBatches(batch, batchCfg, this.batchLimits);
    this.batchesDispatched += subBatches.length;
    this.pagesDispatched += batch.length;
    for (const subBatch of subBatches) pushSample(this.batchPageSamples, subBatch.length);

    try {
      await this.simplifierReady;
      const inflightBatches = this.resolveInflightBatches(subBatches, batchCfg);
      for (let offset = 0; offset < subBatches.length; offset += inflightBatches) {
        const active = subBatches.slice(offset, offset + inflightBatches);
        const built = await Promise.all(active.map((subBatch) => this.buildRootSubBatch(subBatch)));
        for (const group of built) nodes.push(...group);
      }
      const buildMs = performance.now() - startedAt;
      pushSample(this.buildSamples, buildMs);
      const transferBytes = nodes.reduce((sum, node) => sum + transferBytesForNode(node), 0);
      return { nodes, buildMs, transferBytes };
    } catch (error) {
      this.failedBatches++;
      if (isHardGpuFailure(error)) {
        this.disabledError = error instanceof Error ? error : new Error(String(error));
      }
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
    // Per-batch buffers are destroyed after each build. The shared device/pipelines are owned by
    // the browser WebGPU implementation and do not need explicit disposal here.
  }

  private rootBatchPageConfig(): RootBatchPageConfig {
    return {
      chunks_per_page: this.cfg.page.chunks_per_page,
      chunk_size: this.cfg.page.chunk_size,
      quadtree_levels: this.cfg.page.quadtree_levels,
    };
  }

  private resolveInflightBatches(
    subBatches: readonly (readonly GpuClodRootBuildRequest[])[],
    cfg: RootBatchPageConfig,
  ): number {
    const requested = Math.max(1, Math.floor(this.config.maxInflightBatches));
    if (requested === 1 || subBatches.length <= 1) return 1;
    const heavyBatch = subBatches.some((batch) => batch.reduce(
      (sum, request) => sum + estimateRootRequestSlotBytes(request, cfg),
      0,
    ) > this.batchLimits.maxTotalSlotBytes * 0.45);
    if (heavyBatch || this.failedBatches > 0) return 1;
    return Math.min(requested, 2);
  }

  private writeView(buffer: GPUBuffer, data: Int32Array | Uint32Array): void {
    this.device.queue.writeBuffer(buffer, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  }

  private async buildRootSubBatch(batch: readonly GpuClodRootBuildRequest[]): Promise<ClodPageNode[]> {
    const plans = planRootBatchChunkSlots(batch, this.rootBatchPageConfig());
    this.chunkSlotsDispatched += plans.length;
    if (plans.length === 0) return [];

    const fieldParams = this.device.createBuffer({
      label: "gpu clod root fieldParams",
      size: FIELD_PARAM_WORDS * U32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const digEdits = this.device.createBuffer({
      label: "gpu clod root digEdits",
      size: DIG_EDIT_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const countReadback = this.device.createBuffer({
      label: "gpu clod root count readback",
      size: plans.length * 2 * U32,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const slots: GpuRootChunkSlot[] = [];
    try {
      this.device.queue.writeBuffer(digEdits, 0, packDigEdits([]));
      this.writeView(fieldParams, packFieldParams(0));
      for (const plan of plans) slots.push(this.createSlot(plan, digEdits, fieldParams));
      const meshes = await this.dispatchAndReadSlots(slots, countReadback);
      return this.buildRootNodesFromMeshes(batch, slots, meshes);
    } finally {
      for (const slot of slots) destroySlot(slot);
      countReadback.destroy();
      fieldParams.destroy();
      digEdits.destroy();
    }
  }

  private createSlot(plan: GpuRootChunkPlan, digEdits: GPUBuffer, fieldParams: GPUBuffer): GpuRootChunkSlot {
    const dims = computeMeshDims(plan.cx, plan.cz, this.cfg.page.chunk_size);
    const storage = (extra = 0) => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | extra;
    const mk = (label: string, size: number, usage: number) => {
      assertBufferWithinLimit(size, this.batchLimits.maxReadbackBufferBytes, `gpu clod root ${label} ${plan.slotIndex}`);
      return this.device.createBuffer({ label: `gpu clod root ${label} ${plan.slotIndex}`, size, usage });
    };
    const slot: Omit<GpuRootChunkSlot, "bindGroup"> = {
      ...plan,
      dims,
      meshParams: mk("meshParams", 16 * U32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
      outPositions: mk("positions", dims.maxVertices * 3 * F32, storage()),
      outNormals: mk("normals", dims.maxVertices * 3 * F32, storage()),
      outMaterials: mk("materials", dims.maxVertices * F32, storage()),
      cellIndex: mk("cellIndex", dims.slotCount * U32, storage()),
      outIndices: mk("indices", dims.maxIndices * U32, storage()),
      indexCount: mk("indexCount", U32, storage(GPUBufferUsage.COPY_DST)),
      vertexCount: mk("vertexCount", U32, storage(GPUBufferUsage.COPY_DST)),
    };
    this.writeView(slot.meshParams, packMeshParams(dims, this.world));
    this.writeView(slot.indexCount, new Uint32Array([0]));
    this.writeView(slot.vertexCount, new Uint32Array([0]));
    return {
      ...slot,
      bindGroup: this.device.createBindGroup({
        label: `gpu clod root bind group ${plan.slotIndex}`,
        layout: this.layout,
        entries: [
          { binding: 0, resource: { buffer: digEdits } },
          { binding: 1, resource: { buffer: fieldParams } },
          { binding: 2, resource: { buffer: slot.meshParams } },
          { binding: 3, resource: { buffer: slot.outPositions } },
          { binding: 4, resource: { buffer: slot.outNormals } },
          { binding: 5, resource: { buffer: slot.outMaterials } },
          { binding: 6, resource: { buffer: slot.cellIndex } },
          { binding: 7, resource: { buffer: slot.outIndices } },
          { binding: 8, resource: { buffer: slot.indexCount } },
          { binding: 9, resource: { buffer: slot.vertexCount } },
        ],
      }),
    };
  }

  private async dispatchAndReadSlots(slots: readonly GpuRootChunkSlot[], countReadback: GPUBuffer): Promise<Map<number, PageMesh>> {
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
      encoder.copyBufferToBuffer(slot.vertexCount, 0, countReadback, offset, U32);
      encoder.copyBufferToBuffer(slot.indexCount, 0, countReadback, offset + U32, U32);
    }
    this.device.queue.submit([encoder.finish()]);
    pushSample(this.encodeSubmitSamples, performance.now() - encodeStart);

    const countStart = performance.now();
    let countMapped = false;
    let rawCounts = new Uint32Array(slots.length * 2);
    try {
      await countReadback.mapAsync(GPUMapMode.READ);
      countMapped = true;
      rawCounts = new Uint32Array(countReadback.getMappedRange().slice(0));
    } finally {
      if (countMapped) countReadback.unmap();
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
    const mkReadback = (label: string, size: number) => this.device.createBuffer({
      label,
      size: Math.max(4, size),
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const posRB = mkReadback("gpu clod root rb positions", layout.positionsBytes);
    const nrmRB = mkReadback("gpu clod root rb normals", layout.normalsBytes);
    const matRB = mkReadback("gpu clod root rb materials", layout.materialsBytes);
    const idxRB = mkReadback("gpu clod root rb indices", layout.indicesBytes);
    const slotsByIndex = new Map(slots.map((slot) => [slot.slotIndex, slot]));
    const geometryStart = performance.now();
    let posMapped = false;
    let nrmMapped = false;
    let matMapped = false;
    let idxMapped = false;
    try {
      const encoder = this.device.createCommandEncoder({ label: "gpu clod root batch readback" });
      for (const range of layout.ranges) {
        const slot = slotsByIndex.get(range.slotIndex);
        if (!slot || range.vertexCount === 0 || range.indexCount === 0) continue;
        encoder.copyBufferToBuffer(slot.outPositions, 0, posRB, range.positionsOffset, range.positionsBytes);
        encoder.copyBufferToBuffer(slot.outNormals, 0, nrmRB, range.normalsOffset, range.normalsBytes);
        encoder.copyBufferToBuffer(slot.outMaterials, 0, matRB, range.materialsOffset, range.materialsBytes);
        encoder.copyBufferToBuffer(slot.outIndices, 0, idxRB, range.indicesOffset, range.indicesBytes);
      }
      this.device.queue.submit([encoder.finish()]);
      await Promise.all([
        posRB.mapAsync(GPUMapMode.READ).then(() => { posMapped = true; }),
        nrmRB.mapAsync(GPUMapMode.READ).then(() => { nrmMapped = true; }),
        matRB.mapAsync(GPUMapMode.READ).then(() => { matMapped = true; }),
        idxRB.mapAsync(GPUMapMode.READ).then(() => { idxMapped = true; }),
      ]);

      const positionsBytes = new Uint8Array(posRB.getMappedRange().slice(0));
      const normalsBytes = new Uint8Array(nrmRB.getMappedRange().slice(0));
      const materialsBytes = new Uint8Array(matRB.getMappedRange().slice(0));
      const indicesBytes = new Uint8Array(idxRB.getMappedRange().slice(0));
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
          new Float32Array(positionsBytes.buffer.slice(range.positionsOffset, range.positionsOffset + range.positionsBytes)),
          new Float32Array(normalsBytes.buffer.slice(range.normalsOffset, range.normalsOffset + range.normalsBytes)),
          new Float32Array(materialsBytes.buffer.slice(range.materialsOffset, range.materialsOffset + range.materialsBytes)),
          new Uint32Array(indicesBytes.buffer.slice(range.indicesOffset, range.indicesOffset + range.indicesBytes)),
          range.vertexCount,
          range.indexCount,
        );
        meshes.set(range.slotIndex, chunkMeshToPageMesh(chunk));
      }
      return meshes;
    } finally {
      pushSample(this.geometryReadbackSamples, performance.now() - geometryStart);
      if (posMapped) posRB.unmap();
      if (nrmMapped) nrmRB.unmap();
      if (matMapped) matRB.unmap();
      if (idxMapped) idxRB.unmap();
      posRB.destroy();
      nrmRB.destroy();
      matRB.destroy();
      idxRB.destroy();
    }
  }

  private assertReadbackLayout(layout: { positionsBytes: number; normalsBytes: number; materialsBytes: number; indicesBytes: number }): void {
    assertBufferWithinLimit(layout.positionsBytes, this.batchLimits.maxReadbackBufferBytes, "gpu clod root rb positions");
    assertBufferWithinLimit(layout.normalsBytes, this.batchLimits.maxReadbackBufferBytes, "gpu clod root rb normals");
    assertBufferWithinLimit(layout.materialsBytes, this.batchLimits.maxReadbackBufferBytes, "gpu clod root rb materials");
    assertBufferWithinLimit(layout.indicesBytes, this.batchLimits.maxReadbackBufferBytes, "gpu clod root rb indices");
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
      chunks[slot.localChunkIndex] = mesh;
      lod0Chunks.set(key, chunks);
    }

    const lod0Nodes = new Map<string, ClodPageNode>();
    for (const [coord, chunks] of lod0Chunks) {
      for (let index = 0; index < P * P; index++) {
        if (!chunks[index]) throw new Error(`GPU streamed-root L0:${coord} has missing chunk output`);
      }
      const [pxText, pzText] = coord.split(",");
      const node = buildLod0Page(Number(pxText), Number(pzText), chunks, this.cfg);
      lod0Nodes.set(coord, node);
    }

    return requests.map((request) => this.buildRootPageFromLod0(request, lod0Nodes));
  }

  private buildRootPageFromLod0(request: GpuClodRootBuildRequest, lod0Nodes: ReadonlyMap<string, ClodPageNode>): ClodPageNode {
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
          const node = buildParentNode(currentLevel, px, pz, childNodes(index, currentLevel, px, pz), this.cfg);
          levelIndex.set(`${px},${pz}`, node);
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

export async function createGpuClodRootMesher(opts: CreateGpuClodRootMesherOptions): Promise<GpuClodRootMesher | null> {
  let device = opts.sharedDevice ?? null;
  try {
    if (!device) {
      const result = await requestWebGpuDevice();
      if (!result.ok) throw new Error(result.message ?? result.reason);
      device = result.device;
    }

    const module = device.createShaderModule({
      label: "gpu clod root mesher shader",
      code: composeTerrainFieldShader(),
    });
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
    const mesher = new BatchedGpuClodRootMesher(device, layout, vertexPipeline, quadPipeline, opts.cfg, opts.world, opts.config);
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

function resolveRuntimeBatchLimits(
  device: GPUDevice,
  config: StreamingRootGpuMesherConfig,
  chunkSize: number,
): RuntimeBatchLimits {
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
  const maxSingleGroupedReadbackBytes = Math.max(
    dims.maxVertices * 3 * F32,
    dims.maxVertices * F32,
    dims.maxIndices * U32,
  );
  const maxReadbackBufferBytes = Math.max(4, Math.floor(maxBufferSize * READBACK_BUFFER_HEADROOM));
  const readbackSlotLimit = Math.max(1, Math.floor(maxReadbackBufferBytes / Math.max(1, maxSingleGroupedReadbackBytes)));
  const storageAllowed = maxSingleStorageBufferBytes <= maxStorageBufferBindingSize;
  const maxChunkSlots = storageAllowed ? Math.max(1, Math.min(DEFAULT_MAX_BATCH_CHUNK_SLOTS, readbackSlotLimit)) : 1;
  const chunkEstimate = estimateChunkSlotBytes(chunkSize).totalBytes;
  const totalBudget = Math.max(
    chunkEstimate,
    Math.min(DEFAULT_MAX_TOTAL_SLOT_BYTES, Math.floor(maxBufferSize * TOTAL_SLOT_BUFFER_HEADROOM)),
  );
  return {
    batchSize: Math.max(1, Math.floor(config.batchSize)),
    maxChunkSlots,
    maxTotalSlotBytes: totalBudget,
    maxReadbackBufferBytes,
  };
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function assertBufferWithinLimit(size: number, limit: number, label: string): void {
  if (size <= limit) return;
  throw new RootGpuBatchLimitError(
    `${label} requires ${size} bytes, above WebGPU-safe limit ${limit}`,
    { px: 0, pz: 0 },
    0,
    size,
    { batchSize: 1, maxChunkSlots: 1, maxTotalSlotBytes: limit },
  );
}

function isHardGpuFailure(error: unknown): boolean {
  if (error instanceof RootGpuBatchLimitError) return true;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /out.?of.?memory|device.?lost|validation|maxBufferSize|GPUValidationError|OperationError/i.test(message);
}

function destroySlot(slot: GpuRootChunkSlot): void {
  slot.meshParams.destroy();
  slot.outPositions.destroy();
  slot.outNormals.destroy();
  slot.outMaterials.destroy();
  slot.cellIndex.destroy();
  slot.outIndices.destroy();
  slot.indexCount.destroy();
  slot.vertexCount.destroy();
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
    const slot = Math.max(0, Math.min(stride - 1, Math.floor(materials[vertex] ?? 0)));
    weights[vertex * stride + slot] = 1;
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
  const { mesh } = weldVertices(filtered.mesh, cfg.simplify.weld_epsilon_cells, {
    position: cfg.validation.position_epsilon,
    normalDot: cfg.validation.normal_dot_min,
    material: cfg.validation.material_weight_epsilon,
  });
  return mesh;
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
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * percentileRank));
  return sorted[index] ?? 0;
}
