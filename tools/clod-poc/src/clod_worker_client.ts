import type { BuildProgress, BuildResult, DirtyCellBounds } from "./clod/quadtree.js";
import type { DigEdit, VoxelEditSnapshot } from "./terrain/terrain.js";
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
  type ClodWorkerRequest,
  type ClodWorkerResponse,
  type SerializedHydrologyTerrain,
  type SerializedParentBatch,
} from "./clod_worker_protocol.js";

const MAX_DIG_EDITS_PER_WORKER_BATCH = 8;

export interface WorkerLod0Rebuild {
  changed: ClodPageNode[];
  dirtyCoords: [number, number][];
  lod0Pages: number;
  lod0Ms: number;
  serializeMs: number;
  serializedBytes: number;
  chunksRemeshed: number;
  chunksTotal: number;
  pendingParents: number;
  requestCount: number;
}

export interface WorkerParentBatch {
  changed: ClodPageNode[];
  parentNodes: number;
  parentMs: number;
  pendingParents: number;
  requestId: number | null;
}

interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

interface DigBatchSlot {
  edits: DigEdit[];
  dirtyRegions: DirtyCellBounds[];
  resolvers: Array<PendingRequest<WorkerLod0Rebuild>>;
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
  private progressHandlers = new Map<number, (progress: BuildProgress) => void>();
  private digPending: DigBatchSlot | null = null;
  private digPumpActive = false;
  private parentsPending = false;
  private parentsHealthy = true;
  private lastParentError: Error | null = null;
  private parentsWaiters: Array<() => void> = [];

  constructor() {
    attachMainThreadCacheBroker(this.worker);
    this.worker.onmessage = (event: MessageEvent) => {
      if (isCacheRpcMessage(event.data)) return;
      this.handleMessage(event.data as ClodWorkerResponse);
    };
    this.worker.onerror = (event) => {
      const error = new Error(event.message || "CLOD worker failed");
      this.rejectAll(error);
      this.onError?.(error);
    };
  }

  buildWorld(
    worldPagesX: number,
    worldPagesZ: number,
    cfg: ClodPagesConfig,
    voxelEdits: VoxelEditSnapshot,
    onProgress: (progress: BuildProgress) => void,
    hydrologyTerrain: SerializedHydrologyTerrain | null = null,
    borderCoastOceanConfig: BorderCoastOceanConfig | null = null,
    cacheDisabled = false,
    terrainSource: TerrainSourceInputs,
  ): Promise<BuildResult> {
    const requestId = this.nextRequestId++;
    const request: ClodWorkerRequest = {
      type: "build",
      requestId,
      worldPagesX,
      worldPagesZ,
      cfg,
      voxelEdits,
      hydrologyTerrain,
      borderCoastOceanConfig,
      cacheDisabled,
      terrainSource,
    };
    this.progressHandlers.set(requestId, onProgress);
    return new Promise((resolve, reject) => {
      this.buildRequests.set(requestId, { resolve, reject });
      this.worker.postMessage(request);
    });
  }

  rebuildAfterDig(edit: DigEdit, dirty: DirtyCellBounds): Promise<WorkerLod0Rebuild> {
    return new Promise((resolve, reject) => {
      if (!this.digPending) {
        this.digPending = {
          edits: [edit],
          dirtyRegions: [{ ...dirty }],
          resolvers: [{ resolve, reject }],
        };
      } else {
        this.digPending.edits.push(edit);
        this.digPending.dirtyRegions.push({ ...dirty });
        this.digPending.resolvers.push({ resolve, reject });
      }
      void this.pumpDigQueue();
    });
  }

  flushParents(): Promise<void> {
    const requestId = this.nextRequestId++;
    const request: ClodWorkerRequest = { type: "flush", requestId };
    return new Promise((resolve, reject) => {
      this.flushRequests.set(requestId, { resolve, reject });
      this.worker.postMessage(request);
    });
  }

  clearCache(): Promise<void> {
    const requestId = this.nextRequestId++;
    const request: ClodWorkerRequest = { type: "clearCache", requestId };
    return new Promise((resolve, reject) => {
      this.clearCacheRequests.set(requestId, { resolve, reject });
      this.worker.postMessage(request);
    });
  }

  isParentsHealthy(): boolean {
    return this.parentsHealthy;
  }

  getLastParentError(): Error | null {
    return this.lastParentError;
  }

  dispose(): void {
    this.worker.terminate();
    this.rejectAll(new Error("CLOD worker disposed"));
  }

  private async pumpDigQueue(): Promise<void> {
    if (this.digPumpActive) return;
    this.digPumpActive = true;
    try {
      while (this.digPending) {
        const batch = this.digPending;
        this.digPending = null;
        for (const part of this.splitDigBatch(batch)) {
          try {
            const result = await this.sendDigBatch(part);
            for (const pending of part.resolvers) pending.resolve(result);
          } catch (error) {
            for (const pending of part.resolvers) pending.reject(error);
          }
        }
      }
    } finally {
      this.digPumpActive = false;
      if (this.digPending) void this.pumpDigQueue();
    }
  }

  private splitDigBatch(batch: DigBatchSlot): DigBatchSlot[] {
    if (batch.edits.length <= MAX_DIG_EDITS_PER_WORKER_BATCH) return [batch];
    const out: DigBatchSlot[] = [];
    for (let start = 0; start < batch.edits.length; start += MAX_DIG_EDITS_PER_WORKER_BATCH) {
      const end = Math.min(batch.edits.length, start + MAX_DIG_EDITS_PER_WORKER_BATCH);
      out.push({
        edits: batch.edits.slice(start, end),
        dirtyRegions: batch.dirtyRegions.slice(start, end),
        resolvers: batch.resolvers.slice(start, end),
      });
    }
    return out;
  }

  private sendDigBatch(batch: DigBatchSlot): Promise<WorkerLod0Rebuild> {
    const requestId = this.nextRequestId++;
    const request: ClodWorkerRequest = { type: "dig", requestId, edits: batch.edits, dirtyRegions: batch.dirtyRegions };
    return new Promise((resolve, reject) => {
      this.digRequests.set(requestId, { resolve, reject });
      this.worker.postMessage(request);
    });
  }

  private resolveParentsWaiters(): void {
    this.parentsPending = false;
    for (const resolve of this.parentsWaiters) resolve();
    this.parentsWaiters = [];
  }

  private handleMessage(message: ClodWorkerResponse): void {
    if (!message || typeof message !== "object" || typeof message.type !== "string") {
      return;
    }
    switch (message.type) {
      case "progress":
        this.progressHandlers.get(message.requestId)?.(message);
        break;
      case "buildComplete": {
        const pending = this.buildRequests.get(message.requestId);
        if (!pending) break;
        this.buildRequests.delete(message.requestId);
        this.progressHandlers.delete(message.requestId);
        this.result = rehydrateBuildResult(message.result);
        this.nodesById = indexNodes(this.result);
        setWorkerCacheSnapshot(message.cacheBuildStats ?? null, message.cacheServiceMetrics ?? null);
        pending.resolve(this.result);
        break;
      }
      case "lod0Rebuilt": {
        const result: WorkerLod0Rebuild = {
          changed: message.changed.map((node) => {
            const target = this.nodesById.get(node.id);
            if (!target) throw new Error(`CLOD worker returned unknown node ${node.id}`);
            return applySerializedNode(target, node, this.nodesById);
          }),
          dirtyCoords: message.dirtyCoords,
          lod0Pages: message.lod0Pages,
          lod0Ms: message.lod0Ms,
          serializeMs: message.serializeMs,
          serializedBytes: message.serializedBytes,
          chunksRemeshed: message.chunksRemeshed,
          chunksTotal: message.chunksTotal,
          pendingParents: message.pendingParents,
          requestCount: message.editCount,
        };
        if (message.pendingParents > 0) this.parentsPending = true;
        for (const rid of message.requestIds) {
          const pending = this.digRequests.get(rid);
          if (pending) {
            this.digRequests.delete(rid);
            pending.resolve(result);
          }
        }
        break;
      }
      case "parentRebuilt":
        this.onParentRebuilt?.(this.rehydrateParentBatch(message));
        break;
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
      case "cacheCleared": {
        const pending = this.clearCacheRequests.get(message.requestId);
        if (!pending) break;
        this.clearCacheRequests.delete(message.requestId);
        setWorkerCacheSnapshot(null, null);
        pending.resolve();
        break;
      }
      case "error":
        this.handleError(message.requestId, new Error(message.message));
        break;
    }
  }

  private rehydrateParentBatch(message: SerializedParentBatch): WorkerParentBatch {
    return {
      requestId: message.requestId,
      changed: message.changed.map((node) => {
        const target = this.nodesById.get(node.id);
        if (!target) throw new Error(`CLOD worker returned unknown node ${node.id}`);
        return applySerializedNode(target, node, this.nodesById);
      }),
      parentNodes: message.parentNodes,
      parentMs: message.parentMs,
      pendingParents: message.pendingParents,
    };
  }

  private releaseParentsWaitersAfterFailure(error: Error): void {
    this.parentsPending = false;
    this.parentsHealthy = false;
    this.lastParentError = error;
    for (const resolve of this.parentsWaiters) resolve();
    this.parentsWaiters = [];
    this.onError?.(error);
  }

  private handleError(requestId: number | null, error: Error): void {
    if (requestId !== null) {
      const pending =
        this.buildRequests.get(requestId) ??
        this.digRequests.get(requestId) ??
        this.flushRequests.get(requestId) ??
        this.clearCacheRequests.get(requestId);
      if (pending) {
        this.buildRequests.delete(requestId);
        this.digRequests.delete(requestId);
        this.flushRequests.delete(requestId);
        this.clearCacheRequests.delete(requestId);
        pending.reject(error);
        return;
      }
    }
    this.releaseParentsWaitersAfterFailure(error);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.buildRequests.values()) pending.reject(error);
    for (const pending of this.digRequests.values()) pending.reject(error);
    for (const pending of this.flushRequests.values()) pending.reject(error);
    for (const pending of this.clearCacheRequests.values()) pending.reject(error);
    this.buildRequests.clear();
    this.digRequests.clear();
    this.flushRequests.clear();
    this.clearCacheRequests.clear();
    this.progressHandlers.clear();
    this.resolveParentsWaiters();
  }
}
