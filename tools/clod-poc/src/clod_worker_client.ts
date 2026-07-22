import type { BuildProgress, BuildResult } from "./clod/quadtree.js";
import type { TerrainFieldConfig, VoxelEditSnapshot, VoxelEditTransaction } from "./terrain/terrain.js";
import type { StartupHeightfieldRaster } from "./terrain/startup_heightfield_raster.js";
import type { HeightmapSource } from "./terrain/heightmap_source.js";
import type { HydrologyGraph } from "./world/hydrology_graph/hydrology_graph.js";
import type { GraphTerrainCarveConfig } from "./water/graph_hydrology.js";
import type { BorderCoastOceanConfig } from "./terrain/border_coast_config.js";
import type { ClodPagesConfig } from "./config.js";
import type { TerrainSourceInputs } from "./cache/terrainSource.js";
import type { FeatureTerrainStamp } from "./world/feature_stamps.js";
import type { ClodPageNode } from "./types.js";
import { setWorkerCacheSnapshot } from "./cache/cacheMetricsBridge.js";
import { attachMainThreadCacheBroker } from "./cache/mainThreadCacheBroker.js";
import { isCacheRpcMessage } from "./cache/cacheWorkerRpc.js";
import { publishStreamRootCacheCounters } from "./cache/clodStreamRootCache.js";
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
import type { HeightfieldTileBuildResult } from "./world/heightfield_tiles/heightfield_tile_cache.js";
import type { WorldTileKey } from "./world/tile_key.js";
import type {
  HeightfieldTileWorkerBuildRequest,
  HeightfieldTileWorkerResponse,
} from "./world/heightfield_tiles/heightfield_tile_worker_protocol.js";
import type { StreamRootBuildComparison } from "./core/hooks.js";
import {
  ClodWorkerStreamRoots,
  type StreamRootCoord,
  type WorkerStreamRootsResult,
} from "./clod_worker_stream_roots.js";

export type { WorkerLod0Rebuild, WorkerParentBatch } from "./clod_worker_client_types.js";
export type { WorkerStreamRootsResult } from "./clod_worker_stream_roots.js";

type ExtendedClodWorkerResponse = ClodWorkerResponse | HeightfieldTileWorkerResponse;

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
  private readonly streamRoots = new ClodWorkerStreamRoots({
    isStopped: () => this.stopped,
    buildOnWorker: (coords, bypassCacheIds) => this.buildStreamRootsOnWorker(coords, bypassCacheIds),
  });

  /** @internal test seam — forwarded to stream-roots collaborator */
  get streamRootCfg(): ClodPagesConfig | null {
    return this.streamRoots.streamRootCfg;
  }
  set streamRootCfg(value: ClodPagesConfig | null) {
    this.streamRoots.streamRootCfg = value;
  }
  /** @internal test seam */
  get streamRootGpuUnavailable(): boolean {
    return this.streamRoots.streamRootGpuUnavailable;
  }
  set streamRootGpuUnavailable(value: boolean) {
    this.streamRoots.streamRootGpuUnavailable = value;
  }

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
    featureStamps: readonly FeatureTerrainStamp[] | undefined = undefined,
    heightmap: HeightmapSource | null = null,
  ): Promise<BuildResult> => {
    if (this.stopped) return Promise.reject(new Error(WORKER_STOPPED_ERROR));
    this.streamRoots.resetForWorld(worldPagesX, worldPagesZ, cfg, terrainSource, cacheDisabled);
    this.streamRoots.markDirtyFromVoxelEdits(voxelEdits, cfg);
    const requestId = this.nextRequestId++;
    const request: ClodWorkerRequest = {
      type: "build", requestId, worldPagesX, worldPagesZ, cfg, voxelEdits,
      terrainFieldConfig, hydrologyTerrain, startupHeightfield, hydrologyGraph, hydrologyCarve, featureStamps,
      borderCoastOceanConfig, cacheDisabled, terrainSource, heightmap,
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
      this.streamRoots.markDirtyFromTransaction(transaction);
      return rebuilt;
    });
  }

  flushParents(): Promise<void> {
    if (this.stopped) return Promise.reject(new Error(WORKER_STOPPED_ERROR));
    return postTrackedRequest(this.flushRequests, this.worker, { type: "flush", requestId: this.nextRequestId++ });
  }

  async clearCache(): Promise<void> {
    if (this.stopped) return Promise.reject(new Error(WORKER_STOPPED_ERROR));
    await this.streamRoots.clearMainCache();
    return postTrackedRequest(this.clearCacheRequests, this.worker, { type: "clearCache", requestId: this.nextRequestId++ });
  }

  buildHeightfieldTiles(
    keys: readonly WorldTileKey[],
    sourceRevision = 0,
    featureStamps?: HeightfieldTileWorkerBuildRequest["featureStamps"],
  ): Promise<HeightfieldTileBuildResult> {
    if (this.stopped) return Promise.reject(new Error(WORKER_STOPPED_ERROR));
    if (keys.length > 2) return Promise.reject(new Error("heightfield tile worker batches are limited to 2 tiles"));
    const requestId = this.nextRequestId++;
    const request: HeightfieldTileWorkerBuildRequest = {
      type: "buildHeightfieldTiles",
      requestId,
      keys: keys.map((key) => ({ x: key.x, z: key.z })),
      sourceRevision,
      featureStamps: featureStamps ? structuredClone(featureStamps) : undefined,
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

  buildStreamRoots(coords: readonly StreamRootCoord[]): Promise<WorkerStreamRootsResult> {
    return this.streamRoots.buildStreamRoots(coords);
  }

  compareStreamRootBuilds(coords: readonly StreamRootCoord[]): Promise<StreamRootBuildComparison[]> {
    return this.streamRoots.compareStreamRootBuilds(coords);
  }

  probeStreamRootHeights(
    points: readonly { x: number; z: number }[],
    level?: number,
  ): Promise<(number | null)[]> {
    return this.streamRoots.probeStreamRootHeights(points, level);
  }

  isParentsHealthy(): boolean { return this.parentsHealthy; }

  getLastParentError(): Error | null { return this.lastParentError; }

  dispose(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.streamRoots.disposeGpuMesher();
    this.worker.terminate();
    this.doRejectAll(new Error("CLOD worker disposed"));
  }

  private buildStreamRootsOnWorker(
    coords: readonly StreamRootCoord[],
    bypassCacheIds?: readonly string[],
  ): Promise<WorkerStreamRootsResult> {
    return postTrackedRequest(this.streamRootsRequests, this.worker, {
      type: "buildStreamRoots",
      requestId: this.nextRequestId++,
      coords: coords.map(({ px, pz, level }) => ({ px, pz, level })),
      bypassCacheIds: bypassCacheIds ? [...bypassCacheIds] : undefined,
    });
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
    this.streamRoots.disposeGpuMesher();
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
