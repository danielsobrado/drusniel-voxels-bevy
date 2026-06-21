import type { BuildProgress, BuildResult, DirtyCellBounds } from "./quadtree.js";
import type { DigEdit } from "./terrain.js";
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
  ): Promise<BuildResult> {
    const requestId = this.nextRequestId++;
    const request: ClodWorkerRequest = { type: "build", requestId, worldPagesX, worldPagesZ, cfg, edits, hydrologyTerrain };
    this.progressHandlers.set(requestId, onProgress);
    return new Promise((resolve, reject) => {
      this.buildRequests.set(requestId, { resolve, reject });
      this.worker.postMessage(request);
    });
  }

  rebuildAfterDig(edit: DigEdit, dirty: DirtyCellBounds): Promise<WorkerLod0Rebuild> {
    const requestId = this.nextRequestId++;
    const request: ClodWorkerRequest = { type: "dig", requestId, edit, dirty };
    return new Promise((resolve, reject) => {
      this.digRequests.set(requestId, { resolve, reject });
      this.worker.postMessage(request);
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

  dispose(): void {
    this.worker.terminate();
    this.rejectAll(new Error("CLOD worker disposed"));
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
        const pending = this.digRequests.get(message.requestId);
        if (!pending) break;
        this.digRequests.delete(message.requestId);
        const changed = message.changed.map((node) => {
          const target = this.nodesById.get(node.id);
          if (!target) throw new Error(`CLOD worker returned unknown node ${node.id}`);
          return applySerializedNode(target, node, this.nodesById);
        });
        pending.resolve({
          changed,
          dirtyCoords: message.dirtyCoords,
          lod0Pages: message.lod0Pages,
          lod0Ms: message.lod0Ms,
          chunksRemeshed: message.chunksRemeshed,
          chunksTotal: message.chunksTotal,
          pendingParents: message.pendingParents,
        });
        break;
      }
      case "parentRebuilt":
        this.onParentRebuilt?.(this.rehydrateParentBatch(message));
        break;
      case "parentsComplete":
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
    }
    this.onError?.(error);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.buildRequests.values()) pending.reject(error);
    for (const pending of this.digRequests.values()) pending.reject(error);
    for (const pending of this.flushRequests.values()) pending.reject(error);
    this.buildRequests.clear();
    this.digRequests.clear();
    this.flushRequests.clear();
    this.progressHandlers.clear();
  }
}
