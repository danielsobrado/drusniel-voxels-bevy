import { interpolateMeshHeightAt } from "./clod/mesh_height_probe.js";
import type { VoxelEditTransaction } from "./terrain/terrain.js";
import type { ClodPageNode } from "./types.js";
import type { ClodPagesConfig } from "./config.js";
import type { TerrainSourceInputs } from "./cache/terrainSource.js";
import { initClodCacheContext, type ClodCacheContext } from "./cache/clodCacheContext.js";
import {
  createEmptyStreamRootCacheStats,
  publishStreamRootCacheCounters,
  storeStreamRootNode,
  tryLoadStreamRootNode,
} from "./cache/clodStreamRootCache.js";
import {
  createGpuClodRootMesher,
  disabledGpuStats,
  publishGpuClodRootMesherCounters,
  type GpuClodRootMesher,
} from "./terrain/streaming/gpu_clod_root_mesher.js";
import {
  continentTileMeshingEnabled,
  streamingRootGpuMesherConfigFromWindow,
  type StreamingRootGpuMesherConfig,
} from "./terrain/streaming/streamed_root_gpu_config.js";
import {
  StreamedPageBoundsGuardError,
  createStreamedPageBoundsGuardStats,
  isStreamedPageBoundsGuardError,
  publishStreamedPageBoundsGuardStatsToCounters,
  recordStreamedPageBoundsGuardBatchReject,
  recordStreamedPageBoundsGuardCacheDrop,
  recordStreamedPageBoundsGuardCpuFallbackPages,
  recordStreamedPageBoundsGuardResult,
  streamedPageBoundsGuardConfigFromWindow,
  validateStreamedPageBounds,
  type StreamedPageBoundsGuardConfig,
} from "./terrain/streaming/streamed_page_bounds_guard.js";
import { StreamRootEditState } from "./terrain/streaming/stream_root_edit_state.js";
import { uploadHeightfieldTilesForPage } from "./world/heightfield_tiles/heightfield_tile_gpu_atlas.js";
import type { StreamRootBuildComparison } from "./core/hooks.js";
import { WORKER_STOPPED_ERROR } from "./clod_worker_client_types.js";
import { compareStreamRootCpuLeg, compareStreamRootGpuLeg } from "./clod_worker_stream_root_compare.js";

export type StreamRootCoord = { px: number; pz: number; level?: number };
type StreamRootBoundsGuardSource = "gpu" | "cpu" | "cache";

export interface WorkerStreamRootsResult {
  nodes: ClodPageNode[];
  buildMs: number;
  transferBytes: number;
}

export interface ClodWorkerStreamRootsHost {
  isStopped(): boolean;
  buildOnWorker(
    coords: readonly StreamRootCoord[],
    bypassCacheIds?: readonly string[],
  ): Promise<WorkerStreamRootsResult>;
}

function globalClodCounters(): Record<string, number> | undefined {
  return (globalThis as typeof globalThis & {
    window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
  }).window?.__drusnielClod?.stats?.counters;
}

/** Owns GPU mesher lifecycle, cache, bounds guard, and stream-root build routing. */
export class ClodWorkerStreamRoots {
  private cfg: ClodPagesConfig | null = null;
  private worldPagesX = 0;
  private worldPagesZ = 0;
  private cacheInit: Promise<ClodCacheContext | null> | null = null;
  private gpuConfig: StreamingRootGpuMesherConfig = streamingRootGpuMesherConfigFromWindow();
  private gpuMesher: GpuClodRootMesher | null = null;
  private gpuCreatePromise: Promise<GpuClodRootMesher | null> | null = null;
  private gpuUnavailable = false;
  private workerFallbackPages = 0;
  private boundsGuardConfig: StreamedPageBoundsGuardConfig = streamedPageBoundsGuardConfigFromWindow();
  private boundsGuardStats = createStreamedPageBoundsGuardStats();
  private readonly editState = new StreamRootEditState();
  private readonly complexIds = new Set<string>();
  private complexRequestedTotal = 0;
  private ordinaryRequestedTotal = 0;
  private readonly sdfBuildSamplesByLevel: number[][] = [];
  private readonly heightfieldBuildSamplesByLevel: number[][] = [];

  constructor(private readonly host: ClodWorkerStreamRootsHost) {}

  /** Test seam: inject config/availability for compareStreamRootBuilds unit tests. */
  get streamRootCfg(): ClodPagesConfig | null {
    return this.cfg;
  }
  set streamRootCfg(value: ClodPagesConfig | null) {
    this.cfg = value;
  }
  get streamRootGpuUnavailable(): boolean {
    return this.gpuUnavailable;
  }
  set streamRootGpuUnavailable(value: boolean) {
    this.gpuUnavailable = value;
  }

  async clearMainCache(): Promise<void> {
    const cacheCtx = await this.cacheInit?.catch(() => null);
    if (cacheCtx) await cacheCtx.service.clear();
    this.cacheInit = null;
  }

  resetForWorld(
    worldPagesX: number,
    worldPagesZ: number,
    cfg: ClodPagesConfig,
    terrainSource: TerrainSourceInputs,
    cacheDisabled: boolean,
  ): void {
    this.disposeGpuMesher();
    this.cfg = cfg;
    this.worldPagesX = worldPagesX;
    this.worldPagesZ = worldPagesZ;
    this.gpuConfig = streamingRootGpuMesherConfigFromWindow();
    this.boundsGuardConfig = streamedPageBoundsGuardConfigFromWindow();
    this.boundsGuardStats = createStreamedPageBoundsGuardStats();
    this.boundsGuardStats.enabled = this.boundsGuardConfig.enabled ? 1 : 0;
    this.publishBoundsGuardStats();
    this.gpuUnavailable = false;
    this.workerFallbackPages = 0;
    this.editState.reset();
    this.complexIds.clear();
    this.complexRequestedTotal = 0;
    this.ordinaryRequestedTotal = 0;
    this.sdfBuildSamplesByLevel.length = 0;
    this.heightfieldBuildSamplesByLevel.length = 0;
    for (const region of terrainSource.voxelOverlay?.regions ?? []) {
      this.markBoundsDirty(region.bounds, true);
    }
    this.publishComplexStats();
    this.cacheInit = initClodCacheContext({
      cfg,
      worldPages: worldPagesX,
      worldPagesZ,
      terrainSource,
      forceDisabled: cacheDisabled,
      role: "main-pages",
    }).catch((error) => {
      console.warn("[clod-stream-cache] failed to initialize main streamed-root cache", error);
      return null;
    });
    publishGpuClodRootMesherCounters(disabledGpuStats());
  }

  markDirtyFromTransaction(transaction: VoxelEditTransaction): void {
    this.markBoundsDirty(transaction.dirtyBounds);
  }

  markDirtyFromVoxelEdits(voxelEdits: { deltas: readonly { x: number; z: number }[] }, cfg: ClodPagesConfig): void {
    if (voxelEdits.deltas.length === 0) return;
    const baseSpan = cfg.page.chunks_per_page * cfg.page.chunk_size;
    const basePages = new Set(
      voxelEdits.deltas.map((delta) => `${Math.floor(delta.x / baseSpan)},${Math.floor(delta.z / baseSpan)}`),
    );
    for (const key of basePages) {
      const [pageX, pageZ] = key.split(",").map(Number);
      for (let level = 0; level < cfg.page.quadtree_levels; level++) {
        const scale = 2 ** level;
        this.editState.markDirty(`L${level}:${Math.floor(pageX / scale)},${Math.floor(pageZ / scale)}`);
      }
    }
  }

  disposeGpuMesher(): void {
    this.gpuMesher?.dispose();
    this.gpuMesher = null;
    this.gpuCreatePromise = null;
  }

  async buildStreamRoots(coords: readonly StreamRootCoord[]): Promise<WorkerStreamRootsResult> {
    if (this.host.isStopped()) return Promise.reject(new Error(WORKER_STOPPED_ERROR));
    this.gpuConfig = streamingRootGpuMesherConfigFromWindow();
    this.refreshBoundsGuardConfig();
    const ids = coords.map((coord) => this.nodeId(coord));
    const complexIds = ids.filter((id) => this.complexIds.has(id));
    this.complexRequestedTotal += complexIds.length;
    this.ordinaryRequestedTotal += ids.length - complexIds.length;
    this.publishComplexStats();
    const dirtySnapshot = this.editState.captureDirty(ids);
    const cpuAuthoritativeIds = this.editState.cpuAuthoritative(ids);
    if (cpuAuthoritativeIds.length > 0) {
      const built = await this.host.buildOnWorker(coords, cpuAuthoritativeIds);
      if (complexIds.length > 0) this.recordSdfBuild(coords, built.buildMs, complexIds);
      this.assertNodesValid(built.nodes, "cpu");
      this.editState.acknowledge(dirtySnapshot);
      return built;
    }
    if (!this.gpuConfig.enabled) {
      const built = await this.host.buildOnWorker(coords);
      this.assertNodesValid(built.nodes, "cpu");
      return built;
    }

    try {
      const mesher = await this.getGpuMesher();
      if (!mesher) {
        if (!this.gpuConfig.fallback) throw new Error("WebGPU streamed-root mesher unavailable");
        const fallback = await this.buildOnWorkerWithFallbackCounter(coords);
        this.assertNodesValid(fallback.nodes, "cpu");
        return fallback;
      }
      if (this.gpuTileMeshRequested()) {
        const pageSize = this.cfg!.page.chunks_per_page * this.cfg!.page.chunk_size;
        for (const coord of coords) {
          if (!uploadHeightfieldTilesForPage(coord, pageSize)) {
            throw new Error(`GPU tile mesher missing resident heightfield tile for L${coord.level ?? 0}:${coord.px},${coord.pz}`);
          }
        }
      }
      const built = await this.buildOnGpuWithCache(mesher, coords);
      this.recordHeightfieldBuild(coords, built.buildMs, complexIds);
      return built;
    } catch (error) {
      const guardRejected = isStreamedPageBoundsGuardError(error);
      const mesherDisabled = this.gpuMesher?.stats().enabled === 0;
      this.gpuMesher?.recordFallbackPages(coords.length);
      if (mesherDisabled) {
        this.gpuUnavailable = true;
        this.disposeGpuMesher();
      }
      if (!this.gpuConfig.fallback) throw error;
      console.warn(`[clod-stream-gpu] GPU streamed-root batch failed; falling back to CPU worker for ${coords.length} page(s)`, error);
      const fallback = await this.buildOnWorkerWithFallbackCounter(coords);
      if (guardRejected) {
        recordStreamedPageBoundsGuardCpuFallbackPages(this.boundsGuardStats, coords.length);
        this.publishBoundsGuardStats();
      }
      this.assertNodesValid(fallback.nodes, "cpu");
      return fallback;
    }
  }

  async compareStreamRootBuilds(coords: readonly StreamRootCoord[]): Promise<StreamRootBuildComparison[]> {
    if (this.host.isStopped()) return Promise.reject(new Error(WORKER_STOPPED_ERROR));
    this.gpuConfig = streamingRootGpuMesherConfigFromWindow();
    const mesher = await this.getGpuMesher();
    const comparisons: StreamRootBuildComparison[] = [];
    for (const coord of coords) {
      const id = this.nodeId(coord);
      comparisons.push({
        id,
        gpu: await compareStreamRootGpuLeg({
          mesher,
          coord,
          id,
          cfg: this.cfg,
        }),
        cpu: await compareStreamRootCpuLeg({
          coord,
          id,
          buildOnWorker: (c, bypass) => this.host.buildOnWorker(c, bypass),
        }),
      });
    }
    return comparisons;
  }

  async probeStreamRootHeights(
    points: readonly { x: number; z: number }[],
    level?: number,
  ): Promise<(number | null)[]> {
    if (this.host.isStopped()) return Promise.reject(new Error(WORKER_STOPPED_ERROR));
    if (!this.cfg) throw new Error("stream root CLOD config unavailable");
    const rootLevel = this.level(level ?? this.cfg.page.quadtree_levels - 1);
    const spanM = this.cfg.page.chunks_per_page * this.cfg.page.chunk_size * 2 ** rootLevel;
    const coordByKey = new Map<string, StreamRootCoord & { level: number }>();
    const keys = points.map((point) => {
      const px = Math.floor(point.x / spanM);
      const pz = Math.floor(point.z / spanM);
      const key = `${px},${pz}`;
      if (!coordByKey.has(key)) coordByKey.set(key, { px, pz, level: rootLevel });
      return key;
    });
    const coords = [...coordByKey.values()];
    const built = await this.buildStreamRoots(coords);
    const nodeByKey = new Map<string, ClodPageNode>();
    coords.forEach((coord, index) => nodeByKey.set(`${coord.px},${coord.pz}`, built.nodes[index]));
    return points.map((point, index) => {
      const node = nodeByKey.get(keys[index]);
      return node ? interpolateMeshHeightAt(node.mesh, point.x, point.z) : null;
    });
  }

  private async buildOnGpuWithCache(
    mesher: GpuClodRootMesher,
    coords: readonly StreamRootCoord[],
  ): Promise<WorkerStreamRootsResult> {
    const startedAt = performance.now();
    const cacheCtx = await this.cacheInit?.catch(() => null) ?? null;
    const cacheStats = createEmptyStreamRootCacheStats();
    const nodesById = new Map<string, ClodPageNode>();
    const misses: StreamRootCoord[] = [];

    for (const coord of coords) {
      const rootLevel = this.level(coord.level);
      const cached = await tryLoadStreamRootNode(cacheCtx, "gpu", rootLevel, coord.px, coord.pz, cacheStats);
      if (cached && this.acceptNode(cached, "cache")) nodesById.set(cached.id, cached);
      else misses.push(coord);
    }

    if (misses.length > 0) {
      const built = await mesher.buildPages(misses);
      this.assertNodesValid(built.nodes, "gpu");
      const avgBuildMs = built.nodes.length > 0 ? built.buildMs / built.nodes.length : 0;
      for (const node of built.nodes) {
        nodesById.set(node.id, node);
        await storeStreamRootNode(cacheCtx, "gpu", node, avgBuildMs, cacheStats);
      }
      if (cacheCtx) await cacheCtx.service.flush();
    }

    publishStreamRootCacheCounters(cacheStats, "gpu");

    const nodes = coords.map((coord) => {
      const id = this.nodeId(coord);
      const node = nodesById.get(id);
      if (!node) throw new Error(`streamed root cache/GPU build missing ${id}`);
      return node;
    });

    return {
      nodes,
      buildMs: performance.now() - startedAt,
      transferBytes: nodes.reduce((sum, node) => sum + this.transferBytes(node), 0),
    };
  }

  private buildOnWorkerWithFallbackCounter(coords: readonly StreamRootCoord[]): Promise<WorkerStreamRootsResult> {
    this.workerFallbackPages += coords.length;
    if (this.gpuMesher) this.gpuMesher.recordWorkerFallbackPages(coords.length);
    else publishGpuClodRootMesherCounters(disabledGpuStats(this.workerFallbackPages));
    return this.host.buildOnWorker(coords);
  }

  private refreshBoundsGuardConfig(): void {
    this.boundsGuardConfig = streamedPageBoundsGuardConfigFromWindow();
    this.boundsGuardStats.enabled = this.boundsGuardConfig.enabled ? 1 : 0;
    this.publishBoundsGuardStats();
  }

  private gpuTileMeshRequested(): boolean {
    return typeof window !== "undefined" && continentTileMeshingEnabled(new URLSearchParams(window.location.search));
  }

  private acceptNode(node: ClodPageNode, source: StreamRootBoundsGuardSource): boolean {
    const cfg = this.cfg;
    if (!cfg) return true;
    const result = validateStreamedPageBounds(node, cfg.page.chunk_size, this.boundsGuardConfig);
    recordStreamedPageBoundsGuardResult(this.boundsGuardStats, result, this.boundsGuardConfig);
    if (!result.ok) {
      if (source === "cache") recordStreamedPageBoundsGuardCacheDrop(this.boundsGuardStats);
      console.warn(`[clod-stream-bounds] rejected ${source} streamed page ${node.id}: ${result.reason ?? "unknown"}`);
      this.publishBoundsGuardStats();
      return false;
    }
    this.publishBoundsGuardStats();
    return true;
  }

  private assertNodesValid(nodes: readonly ClodPageNode[], source: StreamRootBoundsGuardSource): void {
    const rejected = nodes.filter((node) => !this.acceptNode(node, source));
    if (rejected.length === 0) return;
    if (source === "gpu") recordStreamedPageBoundsGuardBatchReject(this.boundsGuardStats);
    this.publishBoundsGuardStats();
    const results = rejected.map((node) =>
      validateStreamedPageBounds(node, this.cfg!.page.chunk_size, this.boundsGuardConfig),
    );
    throw new StreamedPageBoundsGuardError(
      `streamed-root ${source} build produced ${rejected.length} invalid page(s)`,
      results,
    );
  }

  private publishBoundsGuardStats(): void {
    publishStreamedPageBoundsGuardStatsToCounters(globalClodCounters(), this.boundsGuardStats);
  }

  private async getGpuMesher(): Promise<GpuClodRootMesher | null> {
    if (this.gpuMesher) return this.gpuMesher;
    if (this.gpuUnavailable || !this.cfg) return null;
    if (!this.gpuCreatePromise) {
      const cfg = this.cfg;
      const pageSpan = cfg.page.chunks_per_page * cfg.page.chunk_size;
      const worldCellsX = this.worldPagesX * pageSpan;
      const worldCellsZ = this.worldPagesZ * pageSpan;
      this.gpuCreatePromise = createGpuClodRootMesher({
        cfg,
        world: { cellsX: worldCellsX, cellsZ: worldCellsZ, finite: false },
        config: this.gpuConfig,
      }).then((mesher) => {
        this.gpuMesher = mesher;
        this.gpuUnavailable = mesher === null;
        return mesher;
      }).catch((error) => {
        this.gpuUnavailable = true;
        console.warn("[clod-stream-gpu] failed to create GPU streamed-root mesher", error);
        return null;
      });
    }
    return this.gpuCreatePromise;
  }

  private markBoundsDirty(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, complex = false): void {
    if (!this.cfg) return;
    const baseSpan = this.cfg.page.chunks_per_page * this.cfg.page.chunk_size;
    for (let level = 0; level < this.cfg.page.quadtree_levels; level++) {
      const span = baseSpan * (2 ** level);
      const minX = Math.floor(bounds.minX / span);
      const maxX = Math.floor(bounds.maxX / span);
      const minZ = Math.floor(bounds.minZ / span);
      const maxZ = Math.floor(bounds.maxZ / span);
      for (let pz = minZ; pz <= maxZ; pz++) {
        for (let px = minX; px <= maxX; px++) {
          const id = `L${level}:${px},${pz}`;
          this.editState.markDirty(id);
          if (complex) this.complexIds.add(id);
        }
      }
    }
  }

  private level(level: number | undefined): number {
    if (!this.cfg) throw new Error("stream root CLOD config unavailable");
    return Math.max(0, Math.min(this.cfg.page.quadtree_levels - 1, Math.floor(level ?? 0)));
  }

  private nodeId(coord: StreamRootCoord): string {
    return `L${this.level(coord.level)}:${coord.px},${coord.pz}`;
  }

  private transferBytes(node: ClodPageNode): number {
    return node.mesh.positions.byteLength
      + node.mesh.normals.byteLength
      + node.mesh.paintSlots.byteLength
      + node.mesh.materialWeights.byteLength
      + node.mesh.indices.byteLength;
  }

  private recordSdfBuild(
    coords: readonly StreamRootCoord[],
    buildMs: number,
    complexIds: readonly string[],
  ): void {
    const perPageMs = coords.length > 0 ? buildMs / coords.length : 0;
    const complexSet = new Set(complexIds);
    for (const coord of coords) {
      if (!complexSet.has(this.nodeId(coord))) continue;
      const level = this.level(coord.level);
      const samples = this.sdfBuildSamplesByLevel[level] ??= [];
      samples.push(perPageMs);
      if (samples.length > 128) samples.shift();
    }
    this.publishComplexStats();
  }

  private recordHeightfieldBuild(
    coords: readonly StreamRootCoord[],
    buildMs: number,
    complexIds: readonly string[],
  ): void {
    const perPageMs = coords.length > 0 ? buildMs / coords.length : 0;
    const complexSet = new Set(complexIds);
    for (const coord of coords) {
      if (complexSet.has(this.nodeId(coord))) continue;
      const level = this.level(coord.level);
      const samples = this.heightfieldBuildSamplesByLevel[level] ??= [];
      samples.push(perPageMs);
      if (samples.length > 128) samples.shift();
    }
    this.publishComplexStats();
  }

  private publishComplexStats(): void {
    const counters = typeof window !== "undefined" ? window.__drusnielClod?.stats?.counters : null;
    if (!counters) return;
    const total = this.complexRequestedTotal + this.ordinaryRequestedTotal;
    counters["live_clod_stream_complex_pages_requested_total"] = this.complexRequestedTotal;
    counters["live_clod_stream_heightfield_pages_requested_total"] = this.ordinaryRequestedTotal;
    counters["live_clod_stream_complex_page_share"] = total > 0 ? this.complexRequestedTotal / total : 0;
    for (let level = 0; level < this.sdfBuildSamplesByLevel.length; level++) {
      const sorted = [...(this.sdfBuildSamplesByLevel[level] ?? [])].sort((a, b) => a - b);
      const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
      counters[`live_clod_stream_sdf_build_ms_p95_l${level}`] = sorted[index] ?? 0;
    }
    for (let level = 0; level < this.heightfieldBuildSamplesByLevel.length; level++) {
      const sorted = [...(this.heightfieldBuildSamplesByLevel[level] ?? [])].sort((a, b) => a - b);
      const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
      counters[`live_clod_stream_heightfield_build_ms_p95_l${level}`] = sorted[index] ?? 0;
    }
  }
}
