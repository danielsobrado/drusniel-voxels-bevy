import type { BuildProgress, BuildResult } from "./clod/quadtree.js";
import type { DigEdit, TerrainFieldConfig, VoxelEditSnapshot } from "./terrain/terrain.js";
import type { BorderCoastOceanConfig } from "./terrain/border_coast_config.js";
import type { ClodPageNode } from "./types.js";
import type { ClodPagesConfig } from "./config.js";
import type { TerrainSourceInputs } from "./cache/terrainSource.js";
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

export type { WorkerLod0Rebuild, WorkerParentBatch } from "./clod_worker_client_types.js";

export interface WorkerStreamRootsResult {
  nodes: ClodPageNode[];
  buildMs: number;
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
  private progressHandlers = new Map<number, (progress: BuildProgress) => void>();
  private digPending: DigBatchSlot | null = null;
  private digPumpActive = false;
  private parentsHealthy = true;
  private lastParentError: Error | null = null;
  private parentsWaiters: Array<() => void> = [];
  private stopped = false;

  constructor() {
    attachMainThreadCacheBroker(this.worker);
    this.worker.onmessage = (event: MessageEvent) => {
      if (this.stopped || isCacheRpcMessage(event.data)) return;
      try { this.handleMessage(event.data as ClodWorkerResponse); }
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
  ): Promise<BuildResult> => {
    if (this.stopped) return Promise.reject(new Error(WORKER_STOPPED_ERROR));
    const requestId = this.nextRequestId++;
    const request: ClodWorkerRequest = {
      type: "build", requestId, worldPagesX, worldPagesZ, cfg, voxelEdits,
      terrainFieldConfig, hydrologyTerrain, borderCoastOceanConfig, cacheDisabled, terrainSource,
    };
    this.progressHandlers.set(requestId, onProgress);
    return postTrackedRequest(this.buildRequests, this.worker, request).catch((error) => {
      this.progressHandlers.delete(requestId);
      throw error;
    });
  };

  rebuildAfterDig(edit: DigEdit, dirty: import("./clod/quadtree.js").DirtyCellBounds): Promise<WorkerLod0Rebuild> {
    return new Promise((resolve, reject) => {
      if (this.stopped) { reject(new Error(WORKER_STOPPED_ERROR)); return; }
      if (!this.digPending) {
        this.digPending = { edits: [edit], dirtyRegions: [{ ...dirty }], resolvers: [{ resolve, reject }] };
      } else {
        this.digPending.edits.push(edit);
        this.digPending.dirtyRegions.push({ ...dirty });
        this.digPending.resolvers.push({ resolve, reject });
      }
      void this.pumpDigQueue();
    });
  }

  flushParents(): Promise<void> {
    if (this.stopped) return Promise.reject(new Error(WORKER_STOPPED_ERROR));
    return postTrackedRequest(this.flushRequests, this.worker, { type: "flush", requestId: this.nextRequestId++ });
  }

  clearCache(): Promise<void> {
    if (this.stopped) return Promise.reject(new Error(WORKER_STOPPED_ERROR));
    return postTrackedRequest(this.clearCacheRequests, this.worker, { type: "clearCache", requestId: this.nextRequestId++ });
  }

  /** Build LOD0 root pages off-thread for streaming outside the startup world. */
  buildStreamRoots(coords: readonly { px: number; pz: number }[]): Promise<WorkerStreamRootsResult> {
    if (this.stopped) return Promise.reject(new Error(WORKER_STOPPED_ERROR));
    return postTrackedRequest(this.streamRootsRequests, this.worker, {
      type: "buildStreamRoots",
      requestId: this.nextRequestId++,
      coords: coords.map(({ px, pz }) => ({ px, pz })),
    });
  }

  isParentsHealthy(): boolean { return this.parentsHealthy; }

  getLastParentError(): Error | null { return this.lastParentError; }

  dispose(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.worker.terminate();
    this.doRejectAll(new Error("CLOD worker disposed"));
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

  private handleMessage(message: ClodWorkerResponse): void {
    if (!message || typeof message !== "object" || typeof message.type !== "string") return;
    switch (message.type) {
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
        pending.resolve({ nodes: rehydrateStandaloneNodes(message.nodes), buildMs: message.buildMs });
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
      const pending = this.buildRequests.get(requestId) ?? this.digRequests.get(requestId) ?? this.flushRequests.get(requestId) ?? this.clearCacheRequests.get(requestId) ?? this.streamRootsRequests.get(requestId);
      if (pending) {
        this.buildRequests.delete(requestId);
        this.digRequests.delete(requestId);
        this.flushRequests.delete(requestId);
        this.clearCacheRequests.delete(requestId);
        this.streamRootsRequests.delete(requestId);
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
    this.worker.terminate();
    this.markParentsFailed(err);
    this.doRejectAll(err);
    this.onError?.(err);
  }

  private rejectPendingDig(error: Error): void {
    const pending = this.digPending;
    this.digPending = null;
    if (!pending) return;
    for (const resolver of pending.resolvers) resolver.reject(error);
  }

  private markParentsFailed(error: Error): void {
    this.parentsHealthy = false;
    this.lastParentError = error;
    this.resolveParentsWaiters();
  }

  private resolveParentsWaiters(): void {
    for (const resolve of this.parentsWaiters) resolve();
    this.parentsWaiters = [];
  }

  private doRejectAll(error: Error): void {
    this.rejectPendingDig(error);
    rejectAllMaps(
      [this.buildRequests, this.digRequests, this.flushRequests, this.clearCacheRequests, this.streamRootsRequests],
      this.progressHandlers, error,
    );
    this.resolveParentsWaiters();
  }
}
