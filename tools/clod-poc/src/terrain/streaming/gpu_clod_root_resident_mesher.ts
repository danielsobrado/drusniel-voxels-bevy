import type { ClodPagesConfig } from "../../config.js";
import {
  DIG_EDIT_BYTES,
  FIELD_PARAM_WORDS,
  MESH_PARAM_WORDS,
  Y_CELLS,
  computeMeshDims,
  packDigEdits,
  packFieldParams,
  packMeshParams,
  type MeshDims,
} from "../../gpu/gpu_mesh_buffers.js";
import { ClodBuildError, type ClodPageNode, type PageMesh } from "../../types.js";
import { validateFinalPageMesh } from "../../clod/validate.js";
import { boundsOf, footprintFor, INITIAL_NODE_REVISION } from "../../clod/quadtree_support.js";
import type { WorldBounds } from "../terrain_surface.js";
import { createHeightfieldTileGpuAtlas } from "../../world/heightfield_tiles/heightfield_tile_gpu_atlas.js";
import {
  planRootBatchChunkSlots,
  type GpuRootChunkPlan,
  type RootBatchPageConfig,
} from "./gpu_clod_root_batch_buffers.js";
import { continentTileMeshingEnabled } from "./streamed_root_gpu_config.js";
import {
  shouldKeepGpuClodPageResident,
  type GpuClodHierarchyConfig,
} from "./gpu_clod_hierarchy_config.js";
import {
  GpuClodPagePipeline,
  type GpuClodChunkSource,
  type GpuClodPageIdentity,
} from "./gpu_clod_page_pipeline.js";
import type { GpuClodResidentPage } from "./gpu_clod_resident_types.js";
import {
  disabledGpuStats,
  publishGpuClodRootMesherCounters,
  terrainFieldShaderWithTileAtlas,
  type CreateGpuClodRootMesherOptions,
  type GpuClodRootBuildRequest,
  type GpuClodRootBuildResult,
  type GpuClodRootMesher,
  type GpuClodRootMesherStats,
} from "./gpu_clod_root_mesher_single.js";

const WORKGROUP_SIZE = 64;
const U32 = Uint32Array.BYTES_PER_ELEMENT;
const F32 = Float32Array.BYTES_PER_ELEMENT;
const DEFAULT_MAX_CHUNK_SLOTS = 64;
const DEFAULT_MAX_TOTAL_SLOT_BYTES = 512 * 1024 * 1024;
const SAMPLE_LIMIT = 128;
const MATERIAL_WEIGHT_STRIDE = 4;

interface ResidentMesherOptions extends CreateGpuClodRootMesherOptions {
  hierarchyConfig: GpuClodHierarchyConfig;
  onResidentPage: (page: GpuClodResidentPage) => void;
}

interface HeightAtlasBindings {
  view: GPUTextureView;
  params: GPUBuffer;
  dispose?: () => void;
}

interface PoolSlot extends GpuRootChunkPlan {
  dims: MeshDims;
  counterSlot: number;
  positionOffsetBytes: number;
  normalOffsetBytes: number;
  materialOffsetBytes: number;
  indexOffsetBytes: number;
  bindGroup: GPUBindGroup;
}

class ResidentChunkPool {
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
    const buffer = (label: string, size: number, usage: number) => device.createBuffer({
      label: `gpu clod resident pool ${label}`,
      size: Math.max(4, size),
      usage,
    });
    this.digEdits = buffer("dig edits", DIG_EDIT_BYTES, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.fieldParams = buffer("field params", FIELD_PARAM_WORDS * U32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.positions = buffer("positions", this.positionStrideBytes * capacity, storageUsage());
    this.normals = buffer("normals", this.normalStrideBytes * capacity, storageUsage());
    this.materials = buffer("materials", this.materialStrideBytes * capacity, storageUsage());
    this.cellIndex = buffer("cell indices", this.cellIndexStrideBytes * capacity, storageUsage());
    this.indices = buffer("indices", this.indexStrideBytes * capacity, storageUsage());
    this.indexCounts = buffer("index counts", U32 * capacity, storageUsage(GPUBufferUsage.COPY_DST));
    this.vertexCounts = buffer("vertex counts", U32 * capacity, storageUsage(GPUBufferUsage.COPY_DST));
    for (let slot = 0; slot < capacity; slot++) this.createSlot(slot);
  }

  prepare(plans: readonly GpuRootChunkPlan[]): PoolSlot[] {
    if (plans.length > this.capacity) {
      throw new Error(`GPU resident CLOD pool needs ${plans.length} slots, capacity ${this.capacity}`);
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
    for (const params of this.meshParams) params.destroy();
    this.heightAtlas.dispose?.();
  }

  private createSlot(slot: number): void {
    const params = this.device.createBuffer({
      label: `gpu clod resident mesh params ${slot}`,
      size: MESH_PARAM_WORDS * U32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.meshParams[slot] = params;
    this.bindGroups[slot] = this.device.createBindGroup({
      label: `gpu clod resident bind group ${slot}`,
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: this.digEdits } },
        { binding: 1, resource: { buffer: this.fieldParams } },
        { binding: 2, resource: { buffer: params } },
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

  private prepareSlot(plan: GpuRootChunkPlan): PoolSlot {
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
      packMeshParams(dims, this.world, {
        positionBaseF32,
        normalBaseF32,
        materialBaseF32,
        cellIndexBase,
        indexBase,
        counterSlot,
      }) as Int32Array<ArrayBuffer>,
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

class ResidentGpuClodRootMesher implements GpuClodRootMesher {
  private readonly buildSamples: number[] = [];
  private readonly countReadbackSamples: number[] = [];
  private readonly selectiveReadbackSamples: number[] = [];
  private readonly encodeSamples: number[] = [];
  private readonly batchPageSamples: number[] = [];
  private batchesDispatched = 0;
  private pagesDispatched = 0;
  private chunkSlotsDispatched = 0;
  private fallbackPages = 0;
  private failedBatches = 0;
  private workerFallbackPages = 0;
  private buildTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly device: GPUDevice,
    private readonly vertexPipeline: GPUComputePipeline,
    private readonly quadPipeline: GPUComputePipeline,
    private readonly cfg: ClodPagesConfig,
    private readonly pool: ResidentChunkPool,
    private readonly pagePipeline: GpuClodPagePipeline,
    private readonly hierarchyConfig: GpuClodHierarchyConfig,
    private readonly onResidentPage: (page: GpuClodResidentPage) => void,
  ) {}

  async buildPages(batch: readonly GpuClodRootBuildRequest[]): Promise<GpuClodRootBuildResult> {
    const prior = this.buildTail;
    let release!: () => void;
    this.buildTail = new Promise<void>((resolve) => { release = resolve; });
    try {
      await prior;
      return await this.runBuild(batch);
    } finally {
      release();
    }
  }

  stats(): GpuClodRootMesherStats {
    return {
      enabled: 1,
      batchesDispatched: this.batchesDispatched,
      pagesDispatched: this.pagesDispatched,
      batchPagesP95: percentile(this.batchPageSamples, 0.95),
      chunkSlotsDispatched: this.chunkSlotsDispatched,
      encodeSubmitMsP50: percentile(this.encodeSamples, 0.5),
      encodeSubmitMsP95: percentile(this.encodeSamples, 0.95),
      countReadbackMsP95: percentile(this.countReadbackSamples, 0.95),
      geometryReadbackMsP95: percentile(this.selectiveReadbackSamples, 0.95),
      buildMsP50: percentile(this.buildSamples, 0.5),
      buildMsP95: percentile(this.buildSamples, 0.95),
      buildMsMax: this.buildSamples.reduce((highest, value) => Math.max(highest, value), 0),
      readbackMsP95: percentile([...this.countReadbackSamples, ...this.selectiveReadbackSamples], 0.95),
      fallbackPages: this.fallbackPages,
      failedBatches: this.failedBatches,
      workerFallbackPages: this.workerFallbackPages,
    };
  }

  recordFallbackPages(count: number): void {
    this.fallbackPages += normalizedCount(count);
    publishGpuClodRootMesherCounters(this.stats());
  }

  recordWorkerFallbackPages(count: number): void {
    this.workerFallbackPages += normalizedCount(count);
    publishGpuClodRootMesherCounters(this.stats());
  }

  dispose(): void {
    this.pool.destroy();
  }

  private async runBuild(batch: readonly GpuClodRootBuildRequest[]): Promise<GpuClodRootBuildResult> {
    if (batch.length === 0) return { nodes: [], buildMs: 0, transferBytes: 0 };
    const startedAt = performance.now();
    try {
      this.pagesDispatched += batch.length;
      const nodes: ClodPageNode[] = [];
      let transferBytes = 0;
      for (const request of batch) {
        const result = await this.buildRequest(request);
        nodes.push(result.node);
        transferBytes += result.transferBytes;
      }
      const buildMs = performance.now() - startedAt;
      pushSample(this.buildSamples, buildMs);
      return { nodes, buildMs, transferBytes };
    } catch (error) {
      this.failedBatches++;
      throw error;
    } finally {
      publishGpuClodRootMesherCounters(this.stats());
    }
  }

  private async buildRequest(request: GpuClodRootBuildRequest): Promise<{ node: ClodPageNode; transferBytes: number }> {
    const rootLevel = Math.max(0, Math.min(this.cfg.page.quadtree_levels - 1, Math.floor(request.level ?? 0)));
    const scale = 2 ** rootLevel;
    const lod0Requests: GpuClodRootBuildRequest[] = [];
    for (let dz = 0; dz < scale; dz++) {
      for (let dx = 0; dx < scale; dx++) {
        lod0Requests.push({ px: request.px * scale + dx, pz: request.pz * scale + dz, level: 0 });
      }
    }

    let current = new Map<string, GpuClodResidentPage>();
    try {
      for (const requestBatch of chunked(lod0Requests, this.maxLod0PagesPerDispatch())) {
        const built = await this.buildLod0Batch(requestBatch);
        for (const [key, page] of built) {
          const previous = current.get(key);
          if (previous) this.pagePipeline.destroyPage(previous);
          current.set(key, page);
        }
      }

      for (let level = 1; level <= rootLevel; level++) {
        const next = new Map<string, GpuClodResidentPage>();
        try {
          const parentCoords = new Set<string>();
          for (const key of current.keys()) {
            const [x, z] = key.split(",").map(Number);
            parentCoords.add(`${Math.floor(x! / 2)},${Math.floor(z! / 2)}`);
          }
          for (const coord of [...parentCoords].sort()) {
            const [px, pz] = coord.split(",").map(Number);
            const children = [
              current.get(`${px! * 2},${pz! * 2}`),
              current.get(`${px! * 2 + 1},${pz! * 2}`),
              current.get(`${px! * 2},${pz! * 2 + 1}`),
              current.get(`${px! * 2 + 1},${pz! * 2 + 1}`),
            ];
            if (children.some((child) => !child)) {
              throw new Error(`GPU CLOD parent L${level}:${coord} is missing a child`);
            }
            next.set(
              coord,
              await this.pagePipeline.buildParentPage(
                this.identity(level, px!, pz!),
                children as GpuClodResidentPage[],
              ),
            );
          }
        } catch (error) {
          destroyPages(this.pagePipeline, next.values());
          throw error;
        }
        destroyPages(this.pagePipeline, current.values());
        current = next;
      }

      const rootKey = `${request.px},${request.pz}`;
      const root = current.get(rootKey);
      if (!root) {
        throw new Error(`GPU resident CLOD request L${rootLevel}:${rootKey} produced no root`);
      }
      current.delete(rootKey);
      const shouldResidencyOwn = shouldKeepGpuClodPageResident(this.hierarchyConfig, rootLevel);
      const shouldReadback = !shouldResidencyOwn;
      let finalPage: GpuClodResidentPage | null = null;
      try {
        finalPage = await this.pagePipeline.attachMeshlets(root);
        let mesh = emptyPageMesh();
        let transferBytes = 0;
        let nodeBounds = root.bounds;
        if (shouldReadback) {
          const readbackStartedAt = performance.now();
          mesh = await this.pagePipeline.readbackPage(finalPage);
          pushSample(this.selectiveReadbackSamples, performance.now() - readbackStartedAt);
          normalizeReadbackMaterialWeights(mesh);
          this.validateReadback(mesh, finalPage, rootLevel, request.px, request.pz);
          nodeBounds = boundsOf(mesh);
          transferBytes = meshBytes(mesh);
        }

        const node: ClodPageNode = {
          id: `L${rootLevel}:${request.px},${request.pz}`,
          revision: INITIAL_NODE_REVISION,
          level: rootLevel,
          children: [],
          mesh,
          footprint: footprintFor(rootLevel, request.px, request.pz, this.cfg),
          bounds: nodeBounds,
          errorWorld: root.errorWorld,
          lowBenefit: root.lowBenefit,
          gpuResidentOnly: shouldResidencyOwn,
        };

        if (shouldResidencyOwn) {
          this.onResidentPage(finalPage);
          finalPage = null;
        } else {
          this.pagePipeline.destroyPage(finalPage);
          finalPage = null;
        }
        return { node, transferBytes };
      } finally {
        if (finalPage) this.pagePipeline.destroyPage(finalPage);
      }
    } finally {
      destroyPages(this.pagePipeline, current.values());
    }
  }

  private async buildLod0Batch(
    requests: readonly GpuClodRootBuildRequest[],
  ): Promise<Map<string, GpuClodResidentPage>> {
    const plans = planRootBatchChunkSlots(requests, this.pageConfig());
    if (plans.length === 0) return new Map();
    this.batchesDispatched++;
    this.chunkSlotsDispatched += plans.length;
    pushSample(this.batchPageSamples, requests.length);
    const slots = this.pool.prepare(plans);
    const counts = await this.dispatchAndReadCounts(slots);
    const byPage = new Map<string, PoolSlot[]>();
    for (const slot of slots) {
      const key = `${slot.lod0Px},${slot.lod0Pz}`;
      const pageSlots = byPage.get(key) ?? [];
      pageSlots.push(slot);
      byPage.set(key, pageSlots);
    }

    const result = new Map<string, GpuClodResidentPage>();
    try {
      for (const [coord, pageSlots] of byPage) {
        pageSlots.sort((a, b) => a.localChunkIndex - b.localChunkIndex);
        const [px, pz] = coord.split(",").map(Number);
        const chunks: GpuClodChunkSource[] = pageSlots.map((slot) => {
          const count = counts.get(slot.slotIndex);
          if (!count) throw new Error(`GPU resident CLOD slot ${slot.slotIndex} has no count result`);
          return {
            positionBaseF32: slot.positionOffsetBytes / F32,
            normalBaseF32: slot.normalOffsetBytes / F32,
            materialBaseF32: slot.materialOffsetBytes / F32,
            indexBaseU32: slot.indexOffsetBytes / U32,
            vertexCount: count.vertexCount,
            indexCount: count.indexCount,
          };
        });
        result.set(
          coord,
          await this.pagePipeline.buildLod0Page(
            this.identity(0, px!, pz!),
            {
              positions: this.pool.positions,
              normals: this.pool.normals,
              materials: this.pool.materials,
              indices: this.pool.indices,
            },
            chunks,
          ),
        );
      }
      return result;
    } catch (error) {
      destroyPages(this.pagePipeline, result.values());
      throw error;
    }
  }

  private async dispatchAndReadCounts(
    slots: readonly PoolSlot[],
  ): Promise<Map<number, { vertexCount: number; indexCount: number }>> {
    const readback = this.device.createBuffer({
      label: "gpu resident CLOD count readback",
      size: Math.max(4, slots.length * 2 * U32),
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const encodeStartedAt = performance.now();
    const encoder = this.device.createCommandEncoder({ label: "gpu resident CLOD compute" });
    const vertexPass = encoder.beginComputePass();
    vertexPass.setPipeline(this.vertexPipeline);
    for (const slot of slots) {
      vertexPass.setBindGroup(0, slot.bindGroup);
      vertexPass.dispatchWorkgroups(Math.ceil(slot.dims.slotCount / WORKGROUP_SIZE));
    }
    vertexPass.end();
    const quadPass = encoder.beginComputePass();
    quadPass.setPipeline(this.quadPipeline);
    for (const slot of slots) {
      quadPass.setBindGroup(0, slot.bindGroup);
      quadPass.dispatchWorkgroups(
        Math.ceil((this.cfg.page.chunk_size * this.cfg.page.chunk_size * Y_CELLS * 3) / WORKGROUP_SIZE),
      );
    }
    quadPass.end();
    for (let index = 0; index < slots.length; index++) {
      const slot = slots[index]!;
      encoder.copyBufferToBuffer(
        this.pool.vertexCounts,
        slot.counterSlot * U32,
        readback,
        index * 2 * U32,
        U32,
      );
      encoder.copyBufferToBuffer(
        this.pool.indexCounts,
        slot.counterSlot * U32,
        readback,
        index * 2 * U32 + U32,
        U32,
      );
    }
    this.device.queue.submit([encoder.finish()]);
    pushSample(this.encodeSamples, performance.now() - encodeStartedAt);

    const readStartedAt = performance.now();
    let mapped = false;
    try {
      await readback.mapAsync(GPUMapMode.READ);
      mapped = true;
      const values = new Uint32Array(readback.getMappedRange().slice(0));
      const counts = new Map<number, { vertexCount: number; indexCount: number }>();
      for (let index = 0; index < slots.length; index++) {
        const slot = slots[index]!;
        const vertexCount = values[index * 2] ?? 0;
        const indexCount = values[index * 2 + 1] ?? 0;
        if (vertexCount > slot.dims.maxVertices || indexCount > slot.dims.maxIndices) {
          throw new ClodBuildError(
            "GpuChunkCountOverflow",
            `GPU resident chunk ${slot.cx},${slot.cz} emitted ${vertexCount}/${indexCount} above ${slot.dims.maxVertices}/${slot.dims.maxIndices}`,
          );
        }
        counts.set(slot.slotIndex, { vertexCount, indexCount });
      }
      return counts;
    } finally {
      pushSample(this.countReadbackSamples, performance.now() - readStartedAt);
      if (mapped) readback.unmap();
      readback.destroy();
    }
  }

  private validateReadback(
    mesh: PageMesh,
    page: GpuClodResidentPage,
    level: number,
    px: number,
    pz: number,
  ): void {
    validateFinalPageMesh(
      mesh,
      footprintFor(level, px, pz, this.cfg),
      this.cfg.validation.zero_area_epsilon,
      `${page.id} GPU selective readback`,
    );
  }

  private identity(level: number, px: number, pz: number): GpuClodPageIdentity {
    return {
      id: `L${level}:${px},${pz}`,
      revision: INITIAL_NODE_REVISION,
      level,
      footprint: footprintFor(level, px, pz, this.cfg),
    };
  }

  private pageConfig(): RootBatchPageConfig {
    return {
      chunks_per_page: this.cfg.page.chunks_per_page,
      chunk_size: this.cfg.page.chunk_size,
      quadtree_levels: this.cfg.page.quadtree_levels,
    };
  }

  private maxLod0PagesPerDispatch(): number {
    const slotsPerPage = this.cfg.page.chunks_per_page ** 2;
    return Math.max(1, Math.floor(this.pool.capacity / Math.max(1, slotsPerPage)));
  }
}

export async function createResidentGpuClodRootMesher(
  options: ResidentMesherOptions,
): Promise<GpuClodRootMesher | null> {
  const device = options.sharedDevice;
  if (!device) return null;
  let heightAtlas: HeightAtlasBindings | null = null;
  let pool: ResidentChunkPool | null = null;
  try {
    const module = device.createShaderModule({
      label: "gpu resident CLOD terrain mesher",
      code: terrainFieldShaderWithTileAtlas(),
    });
    heightAtlas = createHeightAtlasBindings(device);
    const storage = (binding: number): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: "storage" },
    });
    const layout = device.createBindGroupLayout({
      label: "gpu resident CLOD terrain layout",
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
        label: "gpu resident CLOD vertex pass",
        layout: pipelineLayout,
        compute: { module, entryPoint: "vertexPass" },
      }),
      device.createComputePipelineAsync({
        label: "gpu resident CLOD quad pass",
        layout: pipelineLayout,
        compute: { module, entryPoint: "quadPass" },
      }),
    ]);
    const capacity = resolvePoolCapacity(device, options.cfg, options.config);
    pool = new ResidentChunkPool(
      device,
      layout,
      options.cfg,
      options.world,
      capacity,
      heightAtlas,
    );
    const pagePipeline = await GpuClodPagePipeline.create(device, {
      fieldParams: pool.fieldParams,
      config: options.hierarchyConfig,
      weldEpsilon: options.cfg.simplify.weld_epsilon_cells,
      normalDotMin: options.cfg.validation.normal_dot_min,
      materialEpsilon: options.cfg.validation.material_weight_epsilon,
      terrainMinY: 0,
      terrainMaxY: Y_CELLS,
    });
    const mesher = new ResidentGpuClodRootMesher(
      device,
      vertexPipeline,
      quadPipeline,
      options.cfg,
      pool,
      pagePipeline,
      options.hierarchyConfig,
      options.onResidentPage,
    );
    publishGpuClodRootMesherCounters(mesher.stats());
    return mesher;
  } catch (error) {
    if (pool) pool.destroy();
    else heightAtlas?.dispose?.();
    console.warn(
      "[clod-stream-gpu] resident hierarchy mesher unavailable; using validated GPU/CPU fallback",
      error,
    );
    publishGpuClodRootMesherCounters(disabledGpuStats());
    return null;
  }
}

function createHeightAtlasBindings(device: GPUDevice): HeightAtlasBindings {
  const search = (globalThis as typeof globalThis & {
    window?: { location?: { search?: string } };
  }).window?.location?.search ?? "";
  const active = continentTileMeshingEnabled(new URLSearchParams(search))
    ? createHeightfieldTileGpuAtlas(device)
    : null;
  if (active) return { view: active.view, params: active.params };

  const texture = device.createTexture({
    label: "gpu resident CLOD disabled height atlas",
    size: { width: 1, height: 1 },
    format: "r32float",
    usage: GPUTextureUsage.TEXTURE_BINDING,
  });
  const params = device.createBuffer({
    label: "gpu resident CLOD disabled height atlas params",
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(params, 0, new Float32Array([1, 1, 1, 0]));
  return {
    view: texture.createView(),
    params,
    dispose: () => {
      texture.destroy();
      params.destroy();
    },
  };
}

function resolvePoolCapacity(
  device: GPUDevice,
  cfg: ClodPagesConfig,
  config: CreateGpuClodRootMesherOptions["config"],
): number {
  const dims = computeMeshDims(0, 0, cfg.page.chunk_size);
  const largestPerSlot = Math.max(
    dims.maxVertices * 3 * F32,
    dims.maxVertices * F32,
    dims.slotCount * U32,
    dims.maxIndices * U32,
  );
  const maxBinding = Number(
    (device.limits as { maxStorageBufferBindingSize?: number }).maxStorageBufferBindingSize
      ?? Number.MAX_SAFE_INTEGER,
  );
  const bindingCapacity = Math.max(1, Math.floor(maxBinding / Math.max(1, largestPerSlot)));
  const configuredSlots = positiveInteger(config.maxChunkSlots, DEFAULT_MAX_CHUNK_SLOTS);
  const slotBytes = dims.maxVertices * 7 * F32
    + dims.slotCount * U32
    + dims.maxIndices * U32
    + 2 * U32;
  const totalBudget = positiveInteger(config.maxTotalSlotBytes, DEFAULT_MAX_TOTAL_SLOT_BYTES);
  const budgetCapacity = Math.max(1, Math.floor(totalBudget / Math.max(1, slotBytes)));
  const capacity = Math.min(configuredSlots, bindingCapacity, budgetCapacity);
  const pageSlots = cfg.page.chunks_per_page ** 2;
  if (capacity < pageSlots) {
    throw new Error(
      `GPU resident CLOD requires ${pageSlots} chunk slots per L0 page, device/budget permits ${capacity}`,
    );
  }
  return capacity;
}

function normalizeReadbackMaterialWeights(mesh: PageMesh): void {
  const vertexTotal = mesh.positions.length / 3;
  const weights = new Float32Array(vertexTotal * MATERIAL_WEIGHT_STRIDE);
  for (let vertex = 0; vertex < vertexTotal; vertex++) {
    const material = Math.max(
      0,
      Math.min(MATERIAL_WEIGHT_STRIDE - 1, Math.floor(mesh.paintSlots[vertex] ?? 0)),
    );
    weights[vertex * MATERIAL_WEIGHT_STRIDE + material] = 1;
  }
  mesh.materialWeights = weights;
  mesh.materialWeightStride = MATERIAL_WEIGHT_STRIDE;
}

function destroyPages(
  pipeline: GpuClodPagePipeline,
  pages: Iterable<GpuClodResidentPage>,
): void {
  for (const page of pages) pipeline.destroyPage(page);
}

function emptyPageMesh(): PageMesh {
  return {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    paintSlots: new Float32Array(0),
    materialWeights: new Float32Array(0),
    materialWeightStride: MATERIAL_WEIGHT_STRIDE,
    indices: new Uint32Array(0),
  };
}

function meshBytes(mesh: PageMesh): number {
  return mesh.positions.byteLength
    + mesh.normals.byteLength
    + mesh.paintSlots.byteLength
    + mesh.materialWeights.byteLength
    + mesh.indices.byteLength;
}

function storageUsage(extra = 0): number {
  return GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | extra;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! > 0 ? Math.floor(value!) : fallback;
}

function normalizedCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function chunked<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function pushSample(samples: number[], value: number): void {
  if (!Number.isFinite(value)) return;
  samples.push(Math.max(0, value));
  if (samples.length > SAMPLE_LIMIT) samples.shift();
}

function percentile(values: readonly number[], rank: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * rank))] ?? 0;
}
