import type { ClodPagesConfig } from "../../config.js";
import {
  Y_CELLS,
  computeMeshDims,
} from "../../gpu/gpu_mesh_buffers.js";
import { ClodBuildError, type ClodPageNode } from "../../types.js";
import { boundsOf, footprintFor, INITIAL_NODE_REVISION } from "../../clod/quadtree_support.js";
import {
  planRootBatchChunkSlots,
  type RootBatchPageConfig,
} from "./gpu_clod_root_batch_buffers.js";
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
  createHeightAtlasBindings,
  terrainFieldShaderWithTileAtlas,
  type HeightAtlasBindings,
} from "./gpu_clod_root_field_shader.js";
import {
  PackedRootGpuBufferPool,
  type GpuRootChunkSlot,
} from "./gpu_clod_root_packed_pool.js";
import {
  emptyPageMesh,
  selectiveReadbackResidentPage,
} from "./gpu_clod_root_resident_readback.js";
import {
  disabledGpuStats,
  publishGpuClodRootMesherCounters,
  type CreateGpuClodRootMesherOptions,
  type GpuClodRootBuildRequest,
  type GpuClodRootBuildResult,
  type GpuClodRootMesher,
  type GpuClodRootMesherStats,
} from "./gpu_clod_root_mesher_single.js";

export {
  emptyPageMesh,
  meshBytes,
  normalizeReadbackMaterialWeights,
  selectiveReadbackResidentPage,
  MATERIAL_WEIGHT_STRIDE,
} from "./gpu_clod_root_resident_readback.js";
export type { SelectiveResidentReadbackResult } from "./gpu_clod_root_resident_readback.js";

const WORKGROUP_SIZE = 64;
const U32 = Uint32Array.BYTES_PER_ELEMENT;
const F32 = Float32Array.BYTES_PER_ELEMENT;
const DEFAULT_MAX_CHUNK_SLOTS = 64;
const DEFAULT_MAX_TOTAL_SLOT_BYTES = 512 * 1024 * 1024;
const SAMPLE_LIMIT = 128;

interface ResidentMesherOptions extends CreateGpuClodRootMesherOptions {
  hierarchyConfig: GpuClodHierarchyConfig;
  onResidentPage: (page: GpuClodResidentPage) => void;
}

/** Resident hierarchy mesher: encode/dispatch facade over PackedRootGpuBufferPool + page pipeline. */
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
    private readonly pool: PackedRootGpuBufferPool,
    private readonly heightAtlas: HeightAtlasBindings,
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
      // The resident mesher keeps the default vertical window; the deep-window retry
      // for fully submerged pages currently exists only in the batched mesher.
      deepWindowRetryPages: 0,
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
    this.heightAtlas.dispose?.();
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
          const readback = await selectiveReadbackResidentPage({
            pagePipeline: this.pagePipeline,
            page: finalPage,
            cfg: this.cfg,
            level: rootLevel,
            px: request.px,
            pz: request.pz,
          });
          pushSample(this.selectiveReadbackSamples, performance.now() - readbackStartedAt);
          mesh = readback.mesh;
          transferBytes = readback.transferBytes;
          nodeBounds = boundsOf(mesh);
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
    const byPage = new Map<string, GpuRootChunkSlot[]>();
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
    slots: readonly GpuRootChunkSlot[],
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
  let pool: PackedRootGpuBufferPool | null = null;
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
    pool = new PackedRootGpuBufferPool(
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
      heightAtlas,
      pagePipeline,
      options.hierarchyConfig,
      options.onResidentPage,
    );
    publishGpuClodRootMesherCounters(mesher.stats());
    return mesher;
  } catch (error) {
    pool?.destroy();
    heightAtlas?.dispose?.();
    console.warn(
      "[clod-stream-gpu] resident hierarchy mesher unavailable; using validated GPU/CPU fallback",
      error,
    );
    publishGpuClodRootMesherCounters(disabledGpuStats());
    return null;
  }
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

function destroyPages(
  pipeline: GpuClodPagePipeline,
  pages: Iterable<GpuClodResidentPage>,
): void {
  for (const page of pages) pipeline.destroyPage(page);
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
