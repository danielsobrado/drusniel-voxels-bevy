import type { BuildResult, DirtyCellBounds, Lod0ChunkPatch, NodeIndex } from "./clod/quadtree.js";
import type { ClodCacheContext } from "./cache/clodCacheContext.js";
import type { ClodPagesConfig } from "./config.js";
import type { ClodPageNode, PageMesh } from "./types.js";

export interface ClodWorkerState {
  cfg: ClodPagesConfig | null;
  workerCacheCtx: ClodCacheContext | null;
  result: BuildResult | null;
  index: NodeIndex | null;
  topLevel: number;
  activeParentRequestId: number | null;
  parentNodes: number;
  parentMs: number;
  drainScheduled: boolean;
  pendingByLevel: Map<number, Set<string>>;
  pendingChildCoordsByLevel: Map<number, [number, number][]>;
}

export interface CombinedLod0Rebuild {
  changed: ClodPageNode[];
  dirtyCoords: [number, number][];
  lod0Pages: number;
  lod0Ms: number;
  chunksRemeshed: number;
  chunksTotal: number;
  chunkPatches: Lod0ChunkPatch[];
  fullPageFallbacks: number;
  pageWeldMs: number;
}

export interface Lod0Snapshot {
  node: ClodPageNode;
  mesh: PageMesh;
  bounds: ClodPageNode["bounds"];
  chunkMeshes?: PageMesh[];
  revision?: number;
}

export interface ParentNodeSnapshot {
  node: ClodPageNode;
  mesh: PageMesh;
  bounds: ClodPageNode["bounds"];
  errorWorld: number;
  lowBenefit: boolean;
  revision?: number;
}

export interface ParentQueueSnapshot {
  pendingByLevel: Map<number, Set<string>>;
  pendingChildCoordsByLevel: Map<number, [number, number][]>;
  activeParentRequestId: number | null;
  parentNodes: number;
  parentMs: number;
}

export interface DirtyContext {
  result: BuildResult;
  cfg: ClodPagesConfig;
  index: NodeIndex;
}

export type DirtyRegionInput = readonly DirtyCellBounds[];
