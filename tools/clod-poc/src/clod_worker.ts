import { initSimplifier } from "./clod/simplify.js";
import {
  buildNodeIndex,
  buildWorldAsync,
  expandQuadSiblingPages,
  rebuildDirtyLod0Pages,
  resimplifyParent,
  type BuildResult,
  type DirtyCellBounds,
  type NodeIndex,
} from "./clod/quadtree.js";
import { nextPendingParentLevelOrdered } from "./clod/parent_queue.js";
import { initClodCacheContext, clearWorkerPersistentCache, type ClodCacheContext } from "./cache/clodCacheContext.js";
import { isCacheRpcResponse } from "./cache/cacheWorkerRpc.js";
import { dispatchCacheRpcResponse } from "./cache/workerRemotePersistentStore.js";
import { createBuildCacheHooks, type CachedBuildStats } from "./cache/clodBuildCache.js";
import {
  addDigEdit,
  getDigEditsSnapshot,
  replaceDigEdits,
  replaceVoxelEdits,
  setBorderCoastRuntime,
  setTerrainSurfaceOverride,
} from "./terrain/terrain.js";
import {
  collectBuildResultTransferables,
  collectNodeTransferables,
  serializeBuildResult,
  serializeNodes,
  type ClodWorkerRequest,
  type ClodWorkerResponse,
  type SerializedHydrologyTerrain,
} from "./clod_worker_protocol.js";
import type { ClodPagesConfig } from "./config.js";
import type { ClodPageNode, PageMesh } from "./types.js";

const DIRTY_BOUNDS_MAX_EPSILON = 1e-6;

const ctx = self as unknown as {
  postMessage: (message: ClodWorkerResponse, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent<ClodWorkerRequest>) => void) | null;
};

let cfg: ClodPagesConfig | null = null;
let workerCacheCtx: ClodCacheContext | null = null;
let result: BuildResult | null = null;
let index: NodeIndex | null = null;
let topLevel = 0;
let activeParentRequestId: number | null = null;
let parentNodes = 0;
let parentMs = 0;
let drainScheduled = false;
const pendingByLevel = new Map<number, Set<string>>();
/** Child page coords resimplified at level L; flushed to enqueue level L+1 once level L drains. */
const pendingChildCoordsByLevel = new Map<number, [number, number][]>();

interface CombinedLod0Rebuild {
  changed: ClodPageNode[];
  dirtyCoords: [number, number][];
  lod0Pages: number;
  lod0Ms: number;
  chunksRemeshed: number;
  chunksTotal: number;
}

interface Lod0Snapshot {
  node: ClodPageNode;
  mesh: PageMesh;
  bounds: ClodPageNode["bounds"];
  chunkMeshes?: PageMesh[];
}

interface ParentNodeSnapshot {
  node: ClodPageNode;
  mesh: PageMesh;
  bounds: ClodPageNode["bounds"];
  errorWorld: number;
  lowBenefit: boolean;
}

interface ParentQueueSnapshot {
  pendingByLevel: Map<number, Set<string>>;
  pendingChildCoordsByLevel: Map<number, [number, number][]>;
  activeParentRequestId: number | null;
  parentNodes: number;
  parentMs: number;
}

function mergeDirty(a: DirtyCellBounds, b: DirtyCellBounds): DirtyCellBounds {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minZ: Math.min(a.minZ, b.minZ),
    maxZ: Math.max(a.maxZ, b.maxZ),
  };
}

function intersectDirty(a: DirtyCellBounds, b: DirtyCellBounds): DirtyCellBounds | null {
  const clipped = {
    minX: Math.max(a.minX, b.minX),
    maxX: Math.min(a.maxX, b.maxX),
    minZ: Math.max(a.minZ, b.minZ),
    maxZ: Math.min(a.maxZ, b.maxZ),
  };
  return clipped.minX < clipped.maxX && clipped.minZ < clipped.maxZ ? clipped : null;
}

function cloneBounds(bounds: ClodPageNode["bounds"]): ClodPageNode["bounds"] {
  return {
    center: [...bounds.center],
    radius: bounds.radius,
    minY: bounds.minY,
    maxY: bounds.maxY,
  };
}

function snapshotLod0Node(node: ClodPageNode): Lod0Snapshot {
  return {
    node,
    mesh: node.mesh,
    bounds: cloneBounds(node.bounds),
    chunkMeshes: node.chunkMeshes ? [...node.chunkMeshes] : undefined,
  };
}

function snapshotLod0Nodes(regions: readonly DirtyCellBounds[]): Lod0Snapshot[] {
  if (!result || !cfg || !index) return [];
  const span = cfg.page.chunks_per_page * cfg.page.chunk_size;
  const keys = new Set<string>();
  for (const dirty of pageParentDirtyGroups(regions)) {
    const touched: [number, number][] = [];
    const minPx = Math.max(0, Math.floor(dirty.minX / span));
    const maxPx = Math.min(result.worldPagesX - 1, Math.floor(dirty.maxX / span));
    const minPz = Math.max(0, Math.floor(dirty.minZ / span));
    const maxPz = Math.min(result.worldPagesZ - 1, Math.floor(dirty.maxZ / span));
    for (let pz = minPz; pz <= maxPz; pz++) {
      for (let px = minPx; px <= maxPx; px++) touched.push([px, pz]);
    }
    for (const [px, pz] of expandQuadSiblingPages(touched, 0, result.worldPagesX, result.worldPagesZ)) {
      keys.add(`${px},${pz}`);
    }
  }
  const snapshots: Lod0Snapshot[] = [];
  for (const key of keys) {
    const node = index[0]?.get(key);
    if (node) snapshots.push(snapshotLod0Node(node));
  }
  return snapshots;
}

function restoreLod0Nodes(snapshots: readonly Lod0Snapshot[]): void {
  for (const snapshot of snapshots) {
    snapshot.node.mesh = snapshot.mesh;
    snapshot.node.bounds = cloneBounds(snapshot.bounds);
    if (snapshot.chunkMeshes) snapshot.node.chunkMeshes = snapshot.chunkMeshes;
    else delete snapshot.node.chunkMeshes;
  }
}

function snapshotParentNode(node: ClodPageNode): ParentNodeSnapshot {
  return {
    node,
    mesh: node.mesh,
    bounds: cloneBounds(node.bounds),
    errorWorld: node.errorWorld,
    lowBenefit: node.lowBenefit,
  };
}

function restoreParentNodes(snapshots: ReadonlyMap<ClodPageNode, ParentNodeSnapshot>): void {
  for (const [node, snapshot] of snapshots) {
    node.mesh = snapshot.mesh;
    node.bounds = cloneBounds(snapshot.bounds);
    node.errorWorld = snapshot.errorWorld;
    node.lowBenefit = snapshot.lowBenefit;
  }
}

function snapshotParentQueue(): ParentQueueSnapshot {
  const copy = new Map<number, Set<string>>();
  for (const [level, keys] of pendingByLevel) copy.set(level, new Set(keys));
  const childCopy = new Map<number, [number, number][]>();
  for (const [level, coords] of pendingChildCoordsByLevel) childCopy.set(level, coords.map((c) => [...c] as [number, number]));
  return {
    pendingByLevel: copy,
    pendingChildCoordsByLevel: childCopy,
    activeParentRequestId,
    parentNodes,
    parentMs,
  };
}

function restoreParentQueue(snapshot: ParentQueueSnapshot): void {
  pendingByLevel.clear();
  for (const [level, keys] of snapshot.pendingByLevel) pendingByLevel.set(level, new Set(keys));
  pendingChildCoordsByLevel.clear();
  for (const [level, coords] of snapshot.pendingChildCoordsByLevel) {
    pendingChildCoordsByLevel.set(level, coords.map((c) => [...c] as [number, number]));
  }
  activeParentRequestId = snapshot.activeParentRequestId;
  parentNodes = snapshot.parentNodes;
  parentMs = snapshot.parentMs;
}

function installHydrologyTerrain(terrain: SerializedHydrologyTerrain | null | undefined): void {
  if (!terrain) {
    setTerrainSurfaceOverride(null);
    return;
  }
  const { res, worldCells, carvedBed } = terrain;
  const scale = (res - 1) / Math.max(1e-6, worldCells);
  setTerrainSurfaceOverride((x, z) => {
    const gx = Math.max(0, Math.min(res - 1, x * scale));
    const gz = Math.max(0, Math.min(res - 1, z * scale));
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const x1 = Math.min(res - 1, x0 + 1);
    const z1 = Math.min(res - 1, z0 + 1);
    const fx = gx - x0;
    const fz = gz - z0;
    const a = carvedBed[z0 * res + x0] * (1 - fx) + carvedBed[z0 * res + x1] * fx;
    const b = carvedBed[z1 * res + x0] * (1 - fx) + carvedBed[z1 * res + x1] * fx;
    return a * (1 - fz) + b * fz;
  });
}

function post(message: ClodWorkerResponse, transfer?: Transferable[]): void {
  if (!transfer || transfer.length === 0) {
    ctx.postMessage(message);
    return;
  }
  const safeTransfer: Transferable[] = [];
  for (const item of transfer) {
    if (!(item instanceof ArrayBuffer) || item.byteLength === 0 || safeTransfer.includes(item)) continue;
    safeTransfer.push(item);
  }
  ctx.postMessage(message, safeTransfer);
}

function errorResponse(requestId: number | null, error: unknown): ClodWorkerResponse {
  const err = error as Error & { code?: string; details?: Record<string, unknown> };
  return {
    type: "error",
    requestId,
    message: err?.message ?? String(error),
    name: err?.name,
    code: err?.code,
    details: err?.details,
  };
}

function pendingParentCount(): number {
  let count = 0;
  for (const set of pendingByLevel.values()) count += set.size;
  return count;
}

function enqueueParent(level: number, nx: number, nz: number): void {
  if (level > topLevel) return;
  let set = pendingByLevel.get(level);
  if (!set) {
    set = new Set();
    pendingByLevel.set(level, set);
  }
  set.add(`${nx},${nz}`);
}

function uniqueParentCoords(childCoords: readonly [number, number][]): [number, number][] {
  const keys = new Set<string>();
  for (const [nx, nz] of childCoords) keys.add(`${nx >> 1},${nz >> 1}`);
  return [...keys].map((key) => key.split(",").map(Number) as [number, number]);
}

function enqueueParentSiblingGroup(parentLevel: number, parentCoords: readonly [number, number][]): void {
  if (!result || parentLevel > topLevel || parentCoords.length === 0) return;
  const expanded = expandQuadSiblingPages(parentCoords, parentLevel, result.worldPagesX, result.worldPagesZ);
  for (const [nx, nz] of expanded) enqueueParent(parentLevel, nx, nz);
}

function enqueueParentsForChildren(childLevel: number, childCoords: readonly [number, number][]): void {
  enqueueParentSiblingGroup(childLevel + 1, uniqueParentCoords(childCoords));
}

function clearPendingParentsFrom(level: number): void {
  for (let l = level; l <= topLevel; l++) pendingByLevel.delete(l);
  for (const l of [...pendingChildCoordsByLevel.keys()]) {
    if (l >= level - 1) pendingChildCoordsByLevel.delete(l);
  }
}

function recordResimplifiedChild(level: number, nx: number, nz: number): void {
  let coords = pendingChildCoordsByLevel.get(level);
  if (!coords) {
    coords = [];
    pendingChildCoordsByLevel.set(level, coords);
  }
  coords.push([nx, nz]);
}

function flushChildEnqueues(completedLevel: number): void {
  const coords = pendingChildCoordsByLevel.get(completedLevel);
  pendingChildCoordsByLevel.delete(completedLevel);
  if (!coords || coords.length === 0) return;
  enqueueParentSiblingGroup(completedLevel + 1, uniqueParentCoords(coords));
}

function enqueueParentsForLod0(coords: readonly [number, number][]): void {
  clearPendingParentsFrom(1);
  enqueueParentsForChildren(0, coords);
}

function nextPendingParent(): { level: number; key: string } | null {
  return nextPendingParentLevelOrdered(pendingByLevel, topLevel);
}

function drainParents(budgetMs: number): void {
  if (!cfg || !index) return;
  const startedAt = performance.now();
  const changed: ClodPageNode[] = [];
  const parentQueueSnapshot = snapshotParentQueue();
  const parentSnapshots = new Map<ClodPageNode, ParentNodeSnapshot>();
  let committed = false;

  try {
    while (pendingParentCount() > 0 && performance.now() - startedAt < budgetMs) {
      const next = nextPendingParent();
      if (!next) break;
      const target = index[next.level]?.get(next.key);
      if (target && !parentSnapshots.has(target)) parentSnapshots.set(target, snapshotParentNode(target));
      const t0 = performance.now();
      const node = resimplifyParent(index, next.level, next.key, cfg, next.level === topLevel);
      parentMs += performance.now() - t0;
      if (!node) continue;
      parentNodes++;
      changed.push(node);
      const [nx, nz] = next.key.split(",").map(Number) as [number, number];
      recordResimplifiedChild(next.level, nx, nz);
      const levelSet = pendingByLevel.get(next.level);
      if (!levelSet || levelSet.size === 0) flushChildEnqueues(next.level);
    }

    if (changed.length > 0) {
      const serialized = serializeNodes(changed);
      const transferables: Transferable[] = [];
      for (const node of serialized) collectNodeTransferables(node, transferables);
      post({
        type: "parentRebuilt",
        requestId: activeParentRequestId,
        changed: serialized,
        parentNodes,
        parentMs,
        pendingParents: pendingParentCount(),
      }, transferables);
    }
    committed = true;
  } catch (error) {
    if (!committed) {
      restoreParentNodes(parentSnapshots);
      restoreParentQueue(parentQueueSnapshot);
    }
    throw error;
  }

  if (pendingParentCount() === 0 && activeParentRequestId !== null) {
    const completedRequestId = activeParentRequestId;
    const completedParentNodes = parentNodes;
    const completedParentMs = parentMs;
    activeParentRequestId = null;
    parentNodes = 0;
    parentMs = 0;
    post({
      type: "parentsComplete",
      requestId: completedRequestId,
      parentNodes: completedParentNodes,
      parentMs: completedParentMs,
    });
  }
}

function scheduleParentDrain(): void {
  if (drainScheduled) return;
  drainScheduled = true;
  setTimeout(() => {
    drainScheduled = false;
    try {
      drainParents(16);
      if (pendingParentCount() > 0) scheduleParentDrain();
    } catch (error) {
      post(errorResponse(activeParentRequestId, error));
    }
  }, 0);
}

function installBorderCoastRuntime(
  config: Extract<ClodWorkerRequest, { type: "build" }>["borderCoastOceanConfig"],
  worldPagesX: number,
  pagesCfg: ClodPagesConfig,
): void {
  const worldCells = worldPagesX * pagesCfg.page.chunks_per_page * pagesCfg.page.chunk_size;
  setBorderCoastRuntime(config ?? null, worldCells);
}

async function handleBuild(request: Extract<ClodWorkerRequest, { type: "build" }>): Promise<void> {
  cfg = request.cfg;
  replaceVoxelEdits(request.voxelEdits);
  installHydrologyTerrain(request.hydrologyTerrain);
  installBorderCoastRuntime(request.borderCoastOceanConfig, request.worldPagesX, request.cfg);
  pendingByLevel.clear();
  pendingChildCoordsByLevel.clear();
  activeParentRequestId = null;
  parentNodes = 0;
  parentMs = 0;
  await initSimplifier();

  const cacheCtx = await initClodCacheContext({
    cfg: request.cfg,
    worldPages: request.worldPagesX,
    terrainSource: request.terrainSource,
    forceDisabled: request.cacheDisabled ?? false,
    role: "worker",
  });
  workerCacheCtx = cacheCtx;
  const cacheStats: CachedBuildStats = {
    nodesFromCache: 0,
    nodesBuilt: 0,
    cacheHits: 0,
    cacheMisses: 0,
    coldBuildMsAvoided: 0,
    cacheDecodeMs: 0,
    netSavedMs: 0,
    coldBuildMs: 0,
  };
  const cacheHooks = cacheCtx?.effective ? createBuildCacheHooks(cacheCtx, cacheStats) : undefined;

  result = await buildWorldAsync(
    request.worldPagesX,
    request.worldPagesZ,
    cfg,
    (progress) => post({ type: "progress", requestId: request.requestId, ...progress }),
    cacheHooks,
  );
  if (cacheCtx) await cacheCtx.service.flush();
  index = buildNodeIndex(result);
  topLevel = Math.max(...result.nodesByLevel.keys());
  const serialized = serializeBuildResult(result);
  const cacheServiceMetrics = cacheCtx?.service.getMetrics();
  post({
    type: "buildComplete",
    requestId: request.requestId,
    result: serialized,
    cacheBuildStats: cacheCtx?.effective ? cacheStats : undefined,
    cacheServiceMetrics: cacheCtx?.effective ? cacheServiceMetrics : undefined,
  }, collectBuildResultTransferables(serialized));
}

function inclusiveMaxBoundary(value: number): number {
  return value - DIRTY_BOUNDS_MAX_EPSILON;
}

function parentGroupFootprint(parentX: number, parentZ: number): DirtyCellBounds {
  if (!result || !cfg) throw new Error("CLOD worker received a dig before build completion");
  const span = cfg.page.chunks_per_page * cfg.page.chunk_size;
  const worldMaxX = result.worldPagesX * span;
  const worldMaxZ = result.worldPagesZ * span;
  return {
    minX: parentX * 2 * span,
    maxX: inclusiveMaxBoundary(Math.min(worldMaxX, (parentX * 2 + 2) * span)),
    minZ: parentZ * 2 * span,
    maxZ: inclusiveMaxBoundary(Math.min(worldMaxZ, (parentZ * 2 + 2) * span)),
  };
}

function pageParentDirtyGroups(regions: readonly DirtyCellBounds[]): DirtyCellBounds[] {
  if (!result || !cfg) throw new Error("CLOD worker received a dig before build completion");
  const span = cfg.page.chunks_per_page * cfg.page.chunk_size;
  const groups = new Map<string, DirtyCellBounds>();
  for (const dirty of regions) {
    const minPx = Math.max(0, Math.floor(dirty.minX / span));
    const maxPx = Math.min(result.worldPagesX - 1, Math.floor(dirty.maxX / span));
    const minPz = Math.max(0, Math.floor(dirty.minZ / span));
    const maxPz = Math.min(result.worldPagesZ - 1, Math.floor(dirty.maxZ / span));
    for (let pz = minPz; pz <= maxPz; pz++) {
      for (let px = minPx; px <= maxPx; px++) {
        const parentX = px >> 1;
        const parentZ = pz >> 1;
        const clipped = intersectDirty(dirty, parentGroupFootprint(parentX, parentZ));
        if (!clipped) continue;
        const key = `${parentX},${parentZ}`;
        const previous = groups.get(key);
        groups.set(key, previous ? mergeDirty(previous, clipped) : clipped);
      }
    }
  }
  return [...groups.values()];
}

function rebuildDirtyRegionGroups(regions: readonly DirtyCellBounds[]): CombinedLod0Rebuild {
  if (!result || !cfg || !index) throw new Error("CLOD worker received a dig before build completion");
  const changedById = new Map<string, ClodPageNode>();
  const dirtyCoordKeys = new Set<string>();
  let lod0Ms = 0;
  let chunksRemeshed = 0;
  let chunksTotal = 0;
  for (const dirty of pageParentDirtyGroups(regions)) {
    const partial = rebuildDirtyLod0Pages(result, dirty, cfg, index);
    lod0Ms += partial.lod0Ms;
    chunksRemeshed += partial.chunksRemeshed;
    chunksTotal += partial.chunksTotal;
    for (const node of partial.changed) changedById.set(node.id, node);
    for (const [x, z] of partial.dirtyCoords) dirtyCoordKeys.add(`${x},${z}`);
  }
  const dirtyCoords = [...dirtyCoordKeys].map((key) => key.split(",").map(Number) as [number, number]);
  return {
    changed: [...changedById.values()],
    dirtyCoords,
    lod0Pages: changedById.size,
    lod0Ms,
    chunksRemeshed,
    chunksTotal,
  };
}

function postLod0Rebuild(requestIds: number[], dirtyRegions: readonly DirtyCellBounds[], editCount: number): void {
  if (!result || !cfg || !index) throw new Error("CLOD worker received a dig before build completion");
  if (requestIds.length === 0 || dirtyRegions.length === 0) return;

  const lod0 = rebuildDirtyRegionGroups(dirtyRegions);
  enqueueParentsForLod0(lod0.dirtyCoords);
  const pendingParents = pendingParentCount();
  if (pendingParents > 0 && activeParentRequestId === null) activeParentRequestId = requestIds[0]!;
  if (pendingParents > 0) scheduleParentDrain();

  const tSer = performance.now();
  const lod0Serialized = serializeNodes(lod0.changed);
  const serializeMs = performance.now() - tSer;
  let serializedBytes = 0;
  const transferables: Transferable[] = [];
  for (const node of lod0Serialized) {
    serializedBytes += node.mesh.positions.byteLength
      + node.mesh.normals.byteLength
      + node.mesh.paintSlots.byteLength
      + node.mesh.materialWeights.byteLength
      + node.mesh.indices.byteLength;
    collectNodeTransferables(node, transferables);
  }

  post({
    type: "lod0Rebuilt",
    requestIds,
    editCount,
    changed: lod0Serialized,
    dirtyCoords: lod0.dirtyCoords.map(([x, z]) => [x, z] as [number, number]),
    lod0Pages: lod0.lod0Pages,
    lod0Ms: lod0.lod0Ms,
    serializeMs,
    serializedBytes,
    chunksRemeshed: lod0.chunksRemeshed,
    chunksTotal: lod0.chunksTotal,
    pendingParents,
  }, transferables);
}

function handleDig(request: Extract<ClodWorkerRequest, { type: "dig" }>): void {
  if (!result || !cfg || !index) throw new Error("CLOD worker received a dig before build completion");
  const previousEdits = getDigEditsSnapshot();
  const lod0Snapshot = snapshotLod0Nodes(request.dirtyRegions);
  const parentQueueSnapshot = snapshotParentQueue();
  try {
    for (const edit of request.edits) addDigEdit(edit);
    postLod0Rebuild([request.requestId], request.dirtyRegions, request.edits.length);
  } catch (error) {
    replaceDigEdits(previousEdits);
    restoreLod0Nodes(lod0Snapshot);
    restoreParentQueue(parentQueueSnapshot);
    throw error;
  }
}

function handleFlush(request: Extract<ClodWorkerRequest, { type: "flush" }>): void {
  drainParents(Number.POSITIVE_INFINITY);
  post({ type: "flushed", requestId: request.requestId });
}

async function handleClearCache(request: Extract<ClodWorkerRequest, { type: "clearCache" }>): Promise<void> {
  if (workerCacheCtx) {
    await workerCacheCtx.service.clear();
    workerCacheCtx = null;
  } else {
    await clearWorkerPersistentCache();
  }
  post({ type: "cacheCleared", requestId: request.requestId });
}

ctx.onmessage = (event: MessageEvent<ClodWorkerRequest>) => {
  if (isCacheRpcResponse(event.data)) {
    dispatchCacheRpcResponse(event.data);
    return;
  }
  const request = event.data;
  try {
    if (request.type === "build") {
      void handleBuild(request).catch((error) => post(errorResponse(request.requestId, error)));
    } else if (request.type === "dig") {
      handleDig(request);
    } else if (request.type === "clearCache") {
      void handleClearCache(request).catch((error) => post(errorResponse(request.requestId, error)));
    } else {
      handleFlush(request);
    }
  } catch (error) {
    post(errorResponse("requestId" in request ? request.requestId : null, error));
  }
};
