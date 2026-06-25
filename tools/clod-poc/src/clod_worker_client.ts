import type { BuildProgress, BuildResult, DirtyCellBounds } from "./clod/quadtree.js";
import type { DigEdit } from "./terrain/terrain.js";
import type { BorderCoastOceanConfig } from "./terrain/border_coast_config.js";
import type { ClodPageNode } from "./types.js";
import type { ClodPagesConfig } from "./config.js";
import {
  applySerializedNode,
  indexNodes,
  rehydrateBuildResult,
  type ClodWorkerRequest,
  type ClodWorkerResponse,
  type SerializedHydrologyTerrain,
  type SerializedParentBatch,
} from "./clod_worker_protocol.js";

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
  dirty: DirtyCellBounds;
  resolvers: Array<PendingRequest<WorkerLod0Rebuild>>;
}

function mergeDirty(a: DirtyCellBounds, b: DirtyCellBounds): DirtyCellBounds {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minZ: Math.min(a.minZ, b.minZ),
    maxZ: Math.max(a.maxZ, b.maxZ),
  };
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
  private progressHandlers = new Map<number, (progress: BuildProgress) => void>();
  private digPending: DigBatchSlot | null = null;
  private digPumpActive = false;
  private parentsPending = false;
  private parentsHealthy = true;
  private lastParentError: Error | null = null;
  private parentsWaiters: Array<() => void> = [];

  constructor() {
    this.worker.onmessage = (event: MessageEvent<ClodWorkerResponse>) => this.handleMessage(event.data);
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
    edits: DigEdit[],
    onProgress: (progress: BuildProgress) => void,
    hydrologyTerrain: SerializedHydrologyTerrain | null = null,
    borderCoastOceanConfig: BorderCoastOceanConfig | null = null,
  ): Promise<BuildResult> {
    const requestId = this.nextRequestId++;
    const request: ClodWorkerRequest = {
      type: "build",
      requestId,
      worldPagesX,
      worldPagesZ,
      cfg,
      edits,
      hydrologyTerrain,
      borderCoastOceanConfig,
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
          dirty: { ...dirty },
          resolvers: [{ resolve, reject }],
        };
      } else {
        this.digPending.edits.push(edit);
        this.digPending.dirty = mergeDirty(this.digPending.dirty, dirty);
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
        try {
          const result = await this.sendDigBatch(batch);
          for (const pending of batch.resolvers) pending.resolve(result);
          await this.waitForParents();
        } catch (error) {
          for (const pending of batch.resolvers) pending.reject(error);
        }
      }
    } finally {
      this.digPumpActive = false;
      if (this.digPending) void this.pumpDigQueue();
    }
  }

  private sendDigBatch(batch: DigBatchSlot): Promise<WorkerLod0Rebuild> {
    const requestId = this.nextRequestId++;
    const request: ClodWorkerRequest = { type: "dig", requestId, edits: batch.edits, dirty: batch.dirty };
    return new Promise((resolve, reject) => {
      this.digRequests.set(requestId, { resolve, reject });
      this.worker.postMessage(request);
    });
  }

  private waitForParents(): Promise<void> {
    if (!this.parentsPending) return Promise.resolve();
    return new Promise((resolve) => {
      this.parentsWaiters.push(resolve);
    });
  }

  private resolveParentsWaiters(): void {
    this.parentsPending = false;
    for (const resolve of this.parentsWaiters) resolve();
    this.parentsWaiters = [];
  }

  private handleMessage(message: ClodWorkerResponse): void {
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
        this.flushRequests.get(requestId);
      if (pending) {
        this.buildRequests.delete(requestId);
        this.digRequests.delete(requestId);
        this.flushRequests.delete(requestId);
        pending.reject(error);
        return;
      }
      // If no matching pending request, the error may be from a parent rebuild
      // (the dig promise was already resolved). Release parent waiters so
      // pumpDigQueue does not hang forever.
      this.releaseParentsWaitersAfterFailure(error);
      return;
    }
    this.onError?.(error);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.buildRequests.values()) pending.reject(error);
    for (const pending of this.digRequests.values()) pending.reject(error);
    for (const pending of this.flushRequests.values()) pending.reject(error);
    if (this.digPending) {
      for (const pending of this.digPending.resolvers) pending.reject(error);
      this.digPending = null;
    }
    this.buildRequests.clear();
    this.digRequests.clear();
    this.flushRequests.clear();
    this.progressHandlers.clear();
    this.resolveParentsWaiters();
  }
}
