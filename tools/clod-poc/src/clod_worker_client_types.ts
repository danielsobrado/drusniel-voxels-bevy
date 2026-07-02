import type { ClodPageNode } from "./types.js";
import type { DirtyCellBounds } from "./clod/quadtree.js";
import type { DigEdit } from "./terrain/terrain.js";
import type { SerializedClodNode } from "./clod_worker_protocol.js";

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

export interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export interface DigBatchSlot {
  edits: DigEdit[];
  dirtyRegions: DirtyCellBounds[];
  resolvers: Array<PendingRequest<WorkerLod0Rebuild>>;
}

export interface NodeTarget {
  node: SerializedClodNode;
  target: ClodPageNode;
}

export const MAX_DIG_EDITS_PER_WORKER_BATCH = 8;
export const WORKER_STOPPED_ERROR = "CLOD worker stopped";
