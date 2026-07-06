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
import { GpuChunkMesher, type ChunkMesh } from "../../gpu/gpu_chunk_mesher.js";
import { buildOuterBorderLocks } from "../../lock.js";
import type { ClodPageNode, PageMesh } from "../../types.js";
import type { WorldBounds } from "../terrain_surface.js";
import type { StreamingRootGpuMesherConfig } from "./streamed_root_gpu_config.js";

const STREAM_COUNTER_SAMPLE_LIMIT = 128;
const DEFAULT_MATERIAL_WEIGHT_STRIDE = 4;

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

class PooledGpuClodRootMesher implements GpuClodRootMesher {
  private nextMesher = 0;
  private readonly buildSamples: number[] = [];
  private readonly readbackSamples: number[] = [];
  private readonly batchPageSamples: number[] = [];
  private batchesDispatched = 0;
  private pagesDispatched = 0;
  private fallbackPages = 0;
  private failedBatches = 0;
  private workerFallbackPages = 0;
  private readonly simplifierReady = initSimplifier();

  constructor(
    private readonly meshers: GpuChunkMesher[],
    private readonly cfg: ClodPagesConfig,
    private readonly world: WorldBounds,
    private readonly config: StreamingRootGpuMesherConfig,
  ) {}

  async buildPages(batch: readonly GpuClodRootBuildRequest[]): Promise<GpuClodRootBuildResult> {
    if (batch.length === 0) return { nodes: [], buildMs: 0, transferBytes: 0 };
    const startedAt = performance.now();
    const nodes: ClodPageNode[] = [];
    const subBatches = chunkRequests(batch, this.config.batchSize);
    this.batchesDispatched += subBatches.length;
    this.pagesDispatched += batch.length;
    for (const subBatch of subBatches) pushSample(this.batchPageSamples, subBatch.length);

    try {
      await this.simplifierReady;
      for (let offset = 0; offset < subBatches.length; offset += this.config.maxInflightBatches) {
        const active = subBatches.slice(offset, offset + this.config.maxInflightBatches);
        const built = await Promise.all(active.map(async (subBatch) => Promise.all(subBatch.map((request) => this.buildRootPage(request)))));
        for (const group of built) nodes.push(...group);
      }
      const buildMs = performance.now() - startedAt;
      pushSample(this.buildSamples, buildMs);
      const transferBytes = nodes.reduce((sum, node) => sum + transferBytesForNode(node), 0);
      return { nodes, buildMs, transferBytes };
    } catch (error) {
      this.failedBatches++;
      throw error;
    } finally {
      publishGpuClodRootMesherCounters(this.stats());
    }
  }

  stats(): GpuClodRootMesherStats {
    return {
      enabled: 1,
      batchesDispatched: this.batchesDispatched,
      pagesDispatched: this.pagesDispatched,
      batchPagesP95: percentile(this.batchPageSamples, 0.95),
      buildMsP50: percentile(this.buildSamples, 0.5),
      buildMsP95: percentile(this.buildSamples, 0.95),
      buildMsMax: this.buildSamples.reduce((max, value) => Math.max(max, value), 0),
      readbackMsP95: percentile(this.readbackSamples, 0.95),
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
    for (const mesher of this.meshers) mesher.destroy();
  }

  private nextGpuMesher(): GpuChunkMesher {
    const mesher = this.meshers[this.nextMesher % this.meshers.length]!;
    this.nextMesher++;
    return mesher;
  }

  private async meshChunk(cx: number, cz: number): Promise<PageMesh> {
    const startedAt = performance.now();
    const mesh = await this.nextGpuMesher().meshChunk(cx, cz, this.world, []);
    pushSample(this.readbackSamples, performance.now() - startedAt);
    return chunkMeshToPageMesh(mesh);
  }

  private async buildLod0Page(px: number, pz: number): Promise<ClodPageNode> {
    const P = this.cfg.page.chunks_per_page;
    const chunkMeshes = new Array<PageMesh>(P * P);
    await Promise.all(Array.from({ length: P * P }, async (_, index) => {
      const dx = index % P;
      const dz = Math.floor(index / P);
      chunkMeshes[index] = await this.meshChunk(px * P + dx, pz * P + dz);
    }));
    const mesh = weldChunkMeshes(chunkMeshes, this.cfg);
    const footprint = footprintFor(0, px, pz, this.cfg);
    const nodeId = `L0:${px},${pz}`;
    validatePageMesh(mesh, footprint, this.cfg.validation.zero_area_epsilon, nodeId);
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
      chunkMeshes,
    };
  }

  private async buildRootPage(request: GpuClodRootBuildRequest): Promise<ClodPageNode> {
    const rootLevel = Math.max(0, Math.min(this.cfg.page.quadtree_levels - 1, Math.floor(request.level ?? 0)));
    const index: Map<string, ClodPageNode>[] = [];
    const lod0Index = new Map<string, ClodPageNode>();
    const lod0Scale = 2 ** rootLevel;
    const lod0BaseX = request.px * lod0Scale;
    const lod0BaseZ = request.pz * lod0Scale;

    const lod0Jobs: Array<Promise<ClodPageNode>> = [];
    for (let pz = lod0BaseZ; pz < lod0BaseZ + lod0Scale; pz++) {
      for (let px = lod0BaseX; px < lod0BaseX + lod0Scale; px++) {
        lod0Jobs.push(this.buildLod0Page(px, pz));
      }
    }
    for (const node of await Promise.all(lod0Jobs)) {
      const [, coord] = node.id.split(":");
      lod0Index.set(coord!, node);
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
  const poolSize = Math.max(1, Math.min(opts.config.maxInflightBatches, opts.config.batchSize));
  const meshers: GpuChunkMesher[] = [];
  try {
    for (let index = 0; index < poolSize; index++) {
      const created = await GpuChunkMesher.create(opts.cfg.page.chunk_size, { sharedDevice: opts.sharedDevice });
      if (!created.mesher) throw new Error(created.unavailable?.message ?? created.unavailable?.reason ?? "WebGPU unavailable");
      meshers.push(created.mesher);
    }
    const mesher = new PooledGpuClodRootMesher(meshers, opts.cfg, opts.world, opts.config);
    publishGpuClodRootMesherCounters(mesher.stats());
    return mesher;
  } catch (error) {
    for (const mesher of meshers) mesher.destroy();
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
    buildMsP50: 0,
    buildMsP95: 0,
    buildMsMax: 0,
    readbackMsP95: 0,
    fallbackPages: 0,
    failedBatches: 0,
    workerFallbackPages,
  };
}

function chunkRequests<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  const safeSize = Math.max(1, Math.floor(size));
  for (let offset = 0; offset < items.length; offset += safeSize) {
    out.push(items.slice(offset, offset + safeSize));
  }
  return out;
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
