import type { BuildProgress, BuildResult } from "./clod/quadtree.js";
import type { TerrainFieldConfig, VoxelEditSnapshot, VoxelEditTransaction } from "./terrain/terrain.js";
import type { StartupHeightfieldRaster } from "./terrain/startup_heightfield_raster.js";
import type { HydrologyGraph } from "./world/hydrology_graph/hydrology_graph.js";
import type { GraphTerrainCarveConfig } from "./water/graph_hydrology.js";
import type { BorderCoastOceanConfig } from "./terrain/border_coast_config.js";
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
import { setWorkerCacheSnapshot } from "./cache/cacheMetricsBridge.js";
import { attachMainThreadCacheBroker } from "./cache/mainThreadCacheBroker.js";
import { isCacheRpcMessage } from "./cache/cacheWorkerRpc.js";
import {
  applySerializedNode,
  indexNodes,
  rehydrateBuildResult,
  rehydrateStandaloneNodes,
  type ClodWorkerRequest,
  type ClodWorkerResponse,
} from "./clod_worker_protocol.js";
import type { WorkerLod0Rebuild, WorkerParentBatch, PendingRequest, DigBatchSlot } from "./clod_worker_client_types.js";
import { WORKER_STOPPED_ERROR } from "./clod_worker_client_types.js";
import {
  collectNodeTargets,
  postTrackedRequest,
  rehydrateParentBatch,
  rejectAllMaps,
  sendDigBatchFn,
  splitDigBatch,
} from "./clod_worker_client_helpers.js";
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
import type { HeightfieldTileBuildResult } from "./world/heightfield_tiles/heightfield_tile_cache.js";
import type { WorldTileKey } from "./world/tile_key.js";
import type {
  HeightfieldTileWorkerBuildRequest,
  HeightfieldTileWorkerResponse,
} from "./world/heightfield_tiles/heightfield_tile_worker_protocol.js";
import { uploadHeightfieldTilesForPage } from "./world/heightfield_tiles/heightfield_tile_gpu_atlas.js";

export type { WorkerLod0Rebuild, WorkerParentBatch } from "./clod_worker_client_types.js";

type StreamRootBoundsGuardSource = "gpu" | "cpu" | "cache";
type ExtendedClodWorkerResponse = ClodWorkerResponse | HeightfieldTileWorkerResponse;

export interface WorkerStreamRootsResult {
  nodes: ClodPageNode[];
  buildMs: number;
  transferBytes: number;
}

function globalClodCounters(): Record<string, number> | undefined {
  return (globalThis as typeof globalThis & {
    window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
  }).window?.__drusnielClod?.stats?.counters;
}

export class ClodWorkerClient {
  onParentRebuilt: ((batch: WorkerParentBatch) => void) | null = null;
  onParentsComplete: ((requestId: number | null, parentNodes: number, parentMs: number) => void) | null = null;
  onError: ((error: Error) => void) | null = null;

  private readonly worker = new Worker(new URL("./clod_worker.ts", import.meta.url), { type: "module" });
  private nextRequestId = 1;
  private result: BuildResult | null = null;
  private nodesById = new Map<string, ClodPageNode>();
  private buildRequests = new Map<number, PendingRequest<BuildResult>>();
  private digRequests = new Map<number, PendingRequest<WorkerLod0Rebuild>>();
  private flushRequests = new Map<number, PendingRequest<void>>();
  private clearCacheRequests = new Map<number, PendingRequest<void>>();
  private streamRootsRequests = new Map<number, PendingRequest<WorkerStreamRootsResult>>();
  private heightfieldTileRequests = new Map<number, PendingRequest<HeightfieldTileBuildResult>>();
  private progressHandlers = new Map<number, (progress: BuildProgress) => void>();
  private digPending: DigBatchSlot | null = null;
  private digPumpActive = false;
  private parentsHealthy = true;
  private lastParentError: Error | null = null;
  private parentsWaiters: Array<() => void> = [];
  private stopped = false;
  private streamRootCfg: ClodPagesConfig | null = null;
  private streamRootWorldPagesX = 0;
  private streamRootWorldPagesZ = 0;
  private streamRootCacheInit: Promise<ClodCacheContext | null> | null = null;
  private streamRootGpuConfig: StreamingRootGpuMesherConfig = streamingRootGpuMesherConfigFromWindow();
  private streamRootGpuMesher: GpuClodRootMesher | null = null;
  private streamRootGpuCreatePromise: Promise<GpuClodRootMesher | null> | null = null;
  private streamRootGpuUnavailable = false;
  private streamRootWorkerFallbackPages = 0;
  private streamRootBoundsGuardConfig: StreamedPageBoundsGuardConfig = streamedPageBoundsGuardConfigFromWindow();
  private streamRootBoundsGuardStats = createStreamedPageBoundsGuardStats();
  private readonly streamRootEditState = new StreamRootEditState();

  constructor() {
    attachMainThreadCacheBroker(this.worker);
    this.worker.onmessage = (event: MessageEvent) => {
      if (this.stopped || isCacheRpcMessage(event.data)) return;
      try { this.handleMessage(event.data as ExtendedClodWorkerResponse); }
      catch (error) { this.failClosed(error); }
    };
    this.worker.onerror = (event) => { this.failClosed(new Error(event.message || "CLOD worker failed")); };
  }

  buildWorld(...args: Parameters<typeof this.doBuildWorld>): Promise<BuildResult> {
    return this.doBuildWorld(...args);
  }

  private doBuildWorld = (
    worldPagesX: number, worldPagesZ: number, cfg: ClodPagesConfig,
    voxelEdits: VoxelEditSnapshot, onProgress: (progress: BuildProgress) => void,
    terrainFieldConfig: TerrainFieldConfig | null = null,
    hydrologyTerrain: any = null,
    borderCoastOceanConfig: BorderCoastOceanConfig | null = null,
    cacheDisabled = false,
    terrainSource: TerrainSourceInputs,
    startupHeightfield: StartupHeightfieldRaster | null = null,
    hydrologyGraph: HydrologyGraph | null = null,
    hydrologyCarve: GraphTerrainCarveConfig | null = null,
  ): Promise<BuildResult> => {
    if (this.stopped) return Promise.reject(new Error(WORKER_STOPPED_ERROR));
    this.resetStreamRootGpuMesherForWorld(worldPagesX, worldPagesZ, cfg, terrainSource, cacheDisabled);
    if (voxelEdits.deltas.length > 0) {
      const baseSpan = cfg.page.chunks_per_page * cfg.page.chunk_size;
      const basePages = new Set(voxelEdits.deltas.map((delta) => `${Math.floor(delta.x / baseSpan)},${Math.floor(delta.z / baseSpan)}`));
      for (const key of basePages) {
        const [pageX, pageZ] = key.split(",").map(Number);
        for (let level = 0; level < cfg.page.quadtree_levels; level++) {
          const scale = 2 ** level;
          this.streamRootEditState.markDirty(`L${level}:${Math.floor(pageX / scale)},${Math.floor(pageZ / scale)}`);
        }
      }
    }
    const requestId = this.nextRequestId++;
    const request: ClodWorkerRequest = {
      type: "build", requestId, worldPagesX, worldPagesZ, cfg, voxelEdits,
      terrainFieldConfig, hydrologyTerrain, startupHeightfield, hydrologyGraph, hydrologyCarve,
      borderCoastOceanConfig, cacheDisabled, terrainSource,
    };
    this.progressHandlers.set(requestId, onProgress);
    return postTrackedRequest(this.buildRequests, this.worker, request).catch((error) => {
      this.progressHandlers.delete(requestId);
      throw error;
    });
  };

  rebuildAfterDig(transaction: VoxelEditTransaction, dirty: import("./clod/quadtree.js").DirtyCellBounds): Promise<WorkerLod0Rebuild> {
    const pending = new Promise<WorkerLod0Rebuild>((resolve, reject) => {
      if (this.stopped) { reject(new Error(WORKER_STOPPED_ERROR)); return; }
      if (!this.digPending) {
        this.digPending = { transactions: [transaction], dirtyRegions: [{ ...dirty }], resolvers: [{ resolve, reject }] };
      } else {
        this.digPending.transactions.push(transaction);
        this.digPending.dirtyRegions.push({ ...dirty });
        this.digPending.resolvers.push({ resolve, reject });
      }
      void this.pumpDigQueue();
    });
    return pending.then((rebuilt) => {
      this.markStreamRootsDirty(transaction);
      return rebuilt;
    });
  }

  flushParents(): Promise<void> {
    if (this.stopped) return Promise.reject(new Error(WORKER_STOPPED_ERROR));
    return postTrackedRequest(this.flushRequests, this.worker, { type: "flush", requestId: this.nextRequestId++ });
  }

  async clearCache(): Promise<void> {
    if (this.stopped) return Promise.reject(new Error(WORKER_STOPPED_ERROR));
    const cacheCtx = await this.streamRootCacheInit?.catch(() => null);
    if (cacheCtx) await cacheCtx.service.clear();
    this.streamRootCacheInit = null;
    return postTrackedRequest(this.clearCacheRequests, this.worker, { type: "clearCache", requestId: this.nextRequestId++ });
  }

  buildHeightfieldTiles(
    keys: readonly WorldTileKey[],
    sourceRevision = 0,
  ): Promise<HeightfieldTileBuildResult> {
    if (this.stopped) return Promise.reject(new Error(WORKER_STOPPED_ERROR));
    if (keys.length > 2) return Promise.reject(new Error("heightfield tile worker batches are limited to 2 tiles"));
    const requestId = this.nextRequestId++;
    const request: HeightfieldTileWorkerBuildRequest = {
      type: "buildHeightfieldTiles",
      requestId,
      keys: keys.map((key) => ({ x: key.x, z: key.z })),
      sourceRevision,
    };
    return new Promise((resolve, reject) => {
      this.heightfieldTileRequests.set(requestId, { resolve, reject });
      try {
        this.worker.postMessage(request);
      } catch (error) {
        this.heightfieldTileRequests.delete(requestId);
        reject(error);
      }
    });
  }

  async buildStreamRoots(coords: readonly { px: number; pz: number; level?: number }[]): Promise<WorkerStreamRootsResult> {
    if (this.stopped) return Promise.reject(new Error(WORKER_STOPPED_ERROR));
    this.streamRootGpuConfig = streamingRootGpuMesherConfigFromWindow();
    this.refreshStreamRootBoundsGuardConfig();
    const ids = coords.map((coord) => this.streamRootNodeId(coord));
    const dirtySnapshot = this.streamRootEditState.captureDirty(ids);
    const cpuAuthoritativeIds = this.streamRootEditState.cpuAuthoritative(ids);
    if (cpuAuthoritativeIds.length > 0) {
      const built = await this.buildStreamRootsOnWorker(coords, cpuAuthoritativeIds);
      this.assertStreamRootNodesValid(built.nodes, "cpu");
      this.streamRootEditState.acknowledge(dirtySnapshot);
      return built;
    }
    if (!this.streamRootGpuConfig.enabled) {
      const built = await this.buildStreamRootsOnWorker(coords);
      this.assertStreamRootNodesValid(built.nodes, "cpu");
      return built;
    }

    try {
      const mesher = await this.getStreamRootGpuMesher();
      if (!mesher) {
        if (!this.streamRootGpuConfig.fallback) throw new Error("WebGPU streamed-root mesher unavailable");
        const fallback = await this.buildStreamRootsOnWorkerWithFallbackCounter(coords);
        this.assertStreamRootNodesValid(fallback.nodes, "cpu");
        return fallback;
      }
      if (this.streamRootGpuTileMeshRequested()) {
        const pageSize = this.streamRootCfg!.page.chunks_per_page * this.streamRootCfg!.page.chunk_size;
        for (const coord of coords) {
          if (!uploadHeightfieldTilesForPage(coord, pageSize)) {
            throw new Error(`GPU tile mesher missing resident heightfield tile for L${coord.level ?? 0}:${coord.px},${coord.pz}`);
          }
        }
      }
      return await this.buildStreamRootsOnGpuWithCache(mesher, coords);
    } catch (error) {
      const guardRejected = isStreamedPageBoundsGuardError(error);
      const mesherDisabled = this.streamRootGpuMesher?.stats().enabled === 0;
      this.streamRootGpuMesher?.recordFallbackPages(coords.length);
      if (mesherDisabled) {
        this.streamRootGpuUnavailable = true;
        this.disposeStreamRootGpuMesher();
      }
      if (!this.streamRootGpuConfig.fallback) throw error;
      console.warn(`[clod-stream-gpu] GPU streamed-root batch failed; falling back to CPU worker for ${coords.length} page(s)`, error);
      const fallback = await this.buildStreamRootsOnWorkerWithFallbackCounter(coords);
      if (guardRejected) {
        recordStreamedPageBoundsGuardCpuFallbackPages(this.streamRootBoundsGuardStats, coords.length);
        this.publishStreamRootBoundsGuardStats();
      }
      this.assertStreamRootNodesValid(fallback.nodes, "cpu");
      return fallback;
    }
  }

  isParentsHealthy(): boolean { return this.parentsHealthy; }

  getLastParentError(): Error | null { return this.lastParentError; }

  dispose(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.disposeStreamRootGpuMesher();
    this.worker.terminate();
    this.doRejectAll(new Error("CLOD worker disposed"));
  }

  private async buildStreamRootsOnGpuWithCache(
    mesher: GpuClodRootMesher,
    coords: readonly { px: number; pz: number; level?: number }[],
  ): Promise<WorkerStreamRootsResult> {
    const startedAt = performance.now();
    const cacheCtx = await this.streamRootCacheInit?.catch(() => null) ?? null;
    const cacheStats = createEmptyStreamRootCacheStats();
    const nodesById = new Map<string, ClodPageNode>();
    const misses: Array<{ px: number; pz: number; level?: number }> = [];

    for (const coord of coords) {
      const rootLevel = this.streamRootLevel(coord.level);
      const cached = await tryLoadStreamRootNode(cacheCtx, "gpu", rootLevel, coord.px, coord.pz, cacheStats);
      if (cached && this.acceptStreamRootNode(cached, "cache")) nodesById.set(cached.id, cached);
      else misses.push(coord);
    }

    if (misses.length > 0) {
      const built = await mesher.buildPages(misses);
      this.assertStreamRootNodesValid(built.nodes, "gpu");
      const avgBuildMs = built.nodes.length > 0 ? built.buildMs / built.nodes.length : 0;
      for (const node of built.nodes) {
        nodesById.set(node.id, node);
        await storeStreamRootNode(cacheCtx, "gpu", node, avgBuildMs, cacheStats);
      }
      if (cacheCtx) await cacheCtx.service.flush();
    }

    publishStreamRootCacheCounters(cacheStats, "gpu");

    const nodes = coords.map((coord) => {
      const id = this.streamRootNodeId(coord);
      const node = nodesById.get(id);
      if (!node) throw new Error(`streamed root cache/GPU build missing ${id}`);
      return node;
    });

    return {
      nodes,
      buildMs: performance.now() - startedAt,
      transferBytes: nodes.reduce((sum, node) => sum + this.streamRootTransferBytes(node), 0),
    };
  }

  private buildStreamRootsOnWorker(
    coords: readonly { px: number; pz: number; level?: number }[],
    bypassCacheIds?: readonly string[],
  ): Promise<WorkerStreamRootsResult> {
    return postTrackedRequest(this.streamRootsRequests, this.worker, {
      type: "buildStreamRoots",
      requestId: this.nextRequestId++,
      coords: coords.map(({ px, pz, level }) => ({ px, pz, level })),
      bypassCacheIds: bypassCacheIds ? [...bypassCacheIds] : undefined,
    });
  }

  private markStreamRootsDirty(transaction: VoxelEditTransaction): void {
    this.markStreamRootBoundsDirty(transaction.dirtyBounds);
  }

  private markStreamRootBoundsDirty(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }): void {
    if (!this.streamRootCfg) return;
    const baseSpan = this.streamRootCfg.page.chunks_per_page * this.streamRootCfg.page.chunk_size;
    for (let level = 0; level < this.streamRootCfg.page.quadtree_levels; level++) {
      const span = baseSpan * (2 ** level);
      const minX = Math.floor(bounds.minX / span);
      const maxX = Math.floor(bounds.maxX / span);
      const minZ = Math.floor(bounds.minZ / span);
      const maxZ = Math.floor(bounds.maxZ / span);
      for (let pz = minZ; pz <= maxZ; pz++) {
        for (let px = minX; px <= maxX; px++) this.streamRootEditState.markDirty(`L${level}:${px},${pz}`);
      }
    }
  }

  private buildStreamRootsOnWorkerWithFallbackCounter(coords: readonly { px: number; pz: number; level?: number }[]): Promise<WorkerStreamRootsResult> {
    this.streamRootWorkerFallbackPages += coords.length;
    if (this.streamRootGpuMesher) this.streamRootGpuMesher.recordWorkerFallbackPages(coords.length);
    else publishGpuClodRootMesherCounters(disabledGpuStats(this.streamRootWorkerFallbackPages));
    return this.buildStreamRootsOnWorker(coords);
  }

  private refreshStreamRootBoundsGuardConfig(): void {
    this.streamRootBoundsGuardConfig = streamedPageBoundsGuardConfigFromWindow();
    this.streamRootBoundsGuardStats.enabled = this.streamRootBoundsGuardConfig.enabled ? 1 : 0;
    this.publishStreamRootBoundsGuardStats();
  }

  private streamRootGpuTileMeshRequested(): boolean {
    return typeof window !== "undefined" && continentTileMeshingEnabled(new URLSearchParams(window.location.search));
  }

  private acceptStreamRootNode(node: ClodPageNode, source: StreamRootBoundsGuardSource): boolean {
    const cfg = this.streamRootCfg;
    if (!cfg) return true;
    const result = validateStreamedPageBounds(node, cfg.page.chunk_size, this.streamRootBoundsGuardConfig);
    recordStreamedPageBoundsGuardResult(this.streamRootBoundsGuardStats, result, this.streamRootBoundsGuardConfig);
    if (!result.ok) {
      if (source === "cache") recordStreamedPageBoundsGuardCacheDrop(this.streamRootBoundsGuardStats);
      console.warn(`[clod-stream-bounds] rejected ${source} streamed page ${node.id}: ${result.reason ?? "unknown"}`);
      this.publishStreamRootBoundsGuardStats();
      return false;
    }
    this.publishStreamRootBoundsGuardStats();
    return true;
  }

  private assertStreamRootNodesValid(nodes: readonly ClodPageNode[], source: StreamRootBoundsGuardSource): void {
    const rejected = nodes.filter((node) => !this.acceptStreamRootNode(node, source));
    if (rejected.length === 0) return;
    if (source === "gpu") recordStreamedPageBoundsGuardBatchReject(this.streamRootBoundsGuardStats);
    this.publishStreamRootBoundsGuardStats();
    const results = rejected.map((node) => validateStreamedPageBounds(node, this.streamRootCfg!.page.chunk_size, this.streamRootBoundsGuardConfig));
    throw new StreamedPageBoundsGuardError(
      `streamed-root ${source} build produced ${rejected.length} invalid page(s)`,
      results,
    );
  }

  private publishStreamRootBoundsGuardStats(): void {
    publishStreamedPageBoundsGuardStatsToCounters(globalClodCounters(), this.streamRootBoundsGuardStats);
  }

  private async getStreamRootGpuMesher(): Promise<GpuClodRootMesher | null> {
    if (this.streamRootGpuMesher) return this.streamRootGpuMesher;
    if (this.streamRootGpuUnavailable || !this.streamRootCfg) return null;
    if (!this.streamRootGpuCreatePromise) {
      const cfg = this.streamRootCfg;
      const pageSpan = cfg.page.chunks_per_page * cfg.page.chunk_size;
      const worldCellsX = this.streamRootWorldPagesX * pageSpan;
      const worldCellsZ = this.streamRootWorldPagesZ * pageSpan;
      this.streamRootGpuCreatePromise = createGpuClodRootMesher({
        cfg,
        world: { cellsX: worldCellsX, cellsZ: worldCellsZ, finite: false },
        config: this.streamRootGpuConfig,
      }).then((mesher) => {
        this.streamRootGpuMesher = mesher;
        this.streamRootGpuUnavailable = mesher === null;
        return mesher;
      }).catch((error) => {
        this.streamRootGpuUnavailable = true;
        console.warn("[clod-stream-gpu] failed to create GPU streamed-root mesher", error);
        return null;
      });
    }
    return this.streamRootGpuCreatePromise;
  }

  private resetStreamRootGpuMesherForWorld(
    worldPagesX: number,
    worldPagesZ: number,
    cfg: ClodPagesConfig,
    terrainSource: TerrainSourceInputs,
    cacheDisabled: boolean,
  ): void {
    this.disposeStreamRootGpuMesher();
    this.streamRootCfg = cfg;
    this.streamRootWorldPagesX = worldPagesX;
    this.streamRootWorldPagesZ = worldPagesZ;
    this.streamRootGpuConfig = streamingRootGpuMesherConfigFromWindow();
    this.streamRootBoundsGuardConfig = streamedPageBoundsGuardConfigFromWindow();
    this.streamRootBoundsGuardStats = createStreamedPageBoundsGuardStats();
    this.streamRootBoundsGuardStats.enabled = this.streamRootBoundsGuardConfig.enabled ? 1 : 0;
    this.publishStreamRootBoundsGuardStats();
    this.streamRootGpuUnavailable = false;
    this.streamRootWorkerFallbackPages = 0;
    this.streamRootEditState.reset();
    this.streamRootCacheInit = initClodCacheContext({
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

  private disposeStreamRootGpuMesher(): void {
    this.streamRootGpuMesher?.dispose();
    this.streamRootGpuMesher = null;
    this.streamRootGpuCreatePromise = null;
  }

  private streamRootLevel(level: number | undefined): number {
    if (!this.streamRootCfg) throw new Error("stream root CLOD config unavailable");
    return Math.max(0, Math.min(this.streamRootCfg.page.quadtree_levels - 1, Math.floor(level ?? 0)));
  }

  private streamRootNodeId(coord: { px: number; pz: number; level?: number }): string {
    return `L${this.streamRootLevel(coord.level)}:${coord.px},${coord.pz}`;
  }

  private streamRootTransferBytes(node: ClodPageNode): number {
    return node.mesh.positions.byteLength
      + node.mesh.normals.byteLength
      + node.mesh.paintSlots.byteLength
      + node.mesh.materialWeights.byteLength
      + node.mesh.indices.byteLength;
  }

  private async pumpDigQueue(): Promise<void> {
    if (this.digPumpActive || this.stopped) return;
    this.digPumpActive = true;
    try {
      while (this.digPending && !this.stopped) {
        const batch = this.digPending;
        this.digPending = null;
        for (const part of splitDigBatch(batch)) {
          try {
            const result = await sendDigBatchFn(part, this.worker, () => this.nextRequestId++, this.digRequests, () => this.stopped, WORKER_STOPPED_ERROR);
            for (const pending of part.resolvers) pending.resolve(result);
          } catch (error) {
            for (const pending of part.resolvers) pending.reject(error);
          }
          if (this.stopped) break;
        }
      }
    } finally {
      this.digPumpActive = false;
      if (this.digPending) {
        if (this.stopped) this.rejectPendingDig(new Error(WORKER_STOPPED_ERROR));
        else void this.pumpDigQueue();
      }
    }
  }

  private handleMessage(message: ExtendedClodWorkerResponse): void {
    if (!message || typeof message !== "object" || typeof message.type !== "string") return;
    switch (message.type) {
      case "heightfieldTilesBuilt": {
        const pending = this.heightfieldTileRequests.get(message.requestId);
        if (!pending) break;
        this.heightfieldTileRequests.delete(message.requestId);
        pending.resolve({ tiles: message.tiles, buildMs: message.buildMs });
        break;
      }
      case "progress": this.progressHandlers.get(message.requestId)?.(message); break;
      case "buildComplete": {
        const pending = this.buildRequests.get(message.requestId);
        if (!pending) break;
        const nextResult = rehydrateBuildResult(message.result);
        const nextNodesById = indexNodes(nextResult);
        setWorkerCacheSnapshot(message.cacheBuildStats ?? null, message.cacheServiceMetrics ?? null);
        this.result = nextResult;
        this.nodesById = nextNodesById;
        this.buildRequests.delete(message.requestId);
        this.progressHandlers.delete(message.requestId);
        pending.resolve(this.result);
        break;
      }
      case "lod0Rebuilt": {
        const targets = collectNodeTargets(message.changed, this.nodesById);
        const result: WorkerLod0Rebuild = {
          changed: targets.map(({ node, target }) => applySerializedNode(target, node, this.nodesById)),
          dirtyCoords: message.dirtyCoords, lod0Pages: message.lod0Pages,
          lod0Ms: message.lod0Ms, serializeMs: message.serializeMs,
          serializedBytes: message.serializedBytes, chunksRemeshed: message.chunksRemeshed,
          chunksTotal: message.chunksTotal, pendingParents: message.pendingParents,
          requestCount: message.editCount,
          chunkPatches: message.chunkPatches ?? [],
          fullPageFallbacks: message.fullPageFallbacks ?? 0,
          pageWeldMs: message.pageWeldMs ?? 0,
        };
        for (const rid of message.requestIds) {
          const pending = this.digRequests.get(rid);
          if (pending) { this.digRequests.delete(rid); pending.resolve(result); }
        }
        break;
      }
      case "parentRebuilt": {
        const batch = rehydrateParentBatch(message, this.nodesById);
        this.onParentRebuilt?.(batch);
        break;
      }
      case "parentsComplete":
        this.parentsHealthy = true;
        this.lastParentError = null;
        this.resolveParentsWaiters();
        this.onParentsComplete?.(message.requestId, message.parentNodes, message.parentMs);
        break;
      case "flushed": {
        const pending = this.flushRequests.get(message.requestId);
        if (!pending) break;
        this.flushRequests.delete(message.requestId);
        pending.resolve();
        break;
      }
      case "streamRootsBuilt": {
        const pending = this.streamRootsRequests.get(message.requestId);
        if (!pending) break;
        this.streamRootsRequests.delete(message.requestId);
        if (message.cacheStats) {
          publishStreamRootCacheCounters(message.cacheStats, "cpu");
        }
        pending.resolve({
          nodes: rehydrateStandaloneNodes(message.nodes),
          buildMs: message.buildMs,
          transferBytes: message.transferBytes,
        });
        break;
      }
      case "cacheCleared": {
        const pending = this.clearCacheRequests.get(message.requestId);
        if (!pending) break;
        this.clearCacheRequests.delete(message.requestId);
        setWorkerCacheSnapshot(null, null);
        pending.resolve();
        break;
      }
      case "error": this.handleError(message.requestId, new Error(message.message)); break;
    }
  }

  private handleError(requestId: number | null, error: Error): void {
    if (requestId !== null) {
      const pending = this.buildRequests.get(requestId)
        ?? this.digRequests.get(requestId)
        ?? this.flushRequests.get(requestId)
        ?? this.clearCacheRequests.get(requestId)
        ?? this.streamRootsRequests.get(requestId)
        ?? this.heightfieldTileRequests.get(requestId);
      if (pending) {
        this.buildRequests.delete(requestId);
        this.digRequests.delete(requestId);
        this.flushRequests.delete(requestId);
        this.clearCacheRequests.delete(requestId);
        this.streamRootsRequests.delete(requestId);
        this.heightfieldTileRequests.delete(requestId);
        pending.reject(error);
        return;
      }
    }
    this.markParentsFailed(error);
    this.onError?.(error);
  }

  private failClosed(error: unknown): void {
    if (this.stopped) return;
    const err = error instanceof Error ? error : new Error(String(error));
    this.stopped = true;
    this.disposeStreamRootGpuMesher();
    this.worker.terminate();
    this.markParentsFailed(err);
    this.doRejectAll(err);
    this.onError?.(err);
  }

  private markParentsFailed(error: Error): void {
    this.parentsHealthy = false;
    this.lastParentError = error;
    this.rejectParentsWaiters(error);
  }

  private resolveParentsWaiters(): void {
    const waiters = this.parentsWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }

  private rejectParentsWaiters(_error: Error): void {
    this.parentsWaiters.splice(0);
  }

  private rejectPendingDig(error: Error): void {
    const batch = this.digPending;
    this.digPending = null;
    if (!batch) return;
    for (const pending of batch.resolvers) pending.reject(error);
  }

  private doRejectAll(error: Error): void {
    rejectAllMaps([
      this.buildRequests,
      this.digRequests,
      this.flushRequests,
      this.clearCacheRequests,
      this.streamRootsRequests,
      this.heightfieldTileRequests,
    ], this.progressHandlers, error);
    this.rejectPendingDig(error);
    this.parentsWaiters.splice(0);
  }
}
