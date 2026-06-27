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
import { initClodCacheContext, clearWorkerPersistentCache, type ClodCacheContext } from "./cache/clodCacheContext.js";
import { isCacheRpcResponse } from "./cache/cacheWorkerRpc.js";
import { dispatchCacheRpcResponse } from "./cache/workerRemotePersistentStore.js";
import { createBuildCacheHooks, type CachedBuildStats } from "./cache/clodBuildCache.js";
import { addDigEdit, replaceVoxelEdits, setBorderCoastRuntime, setTerrainSurfaceOverride } from "./terrain/terrain.js";
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
import type { ClodPageNode } from "./types.js";

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

interface CombinedLod0Rebuild {
  changed: ClodPageNode[];
  dirtyCoords: [number, number][];
  lod0Pages: number;
  lod0Ms: number;
  chunksRemeshed: number;
  chunksTotal: number;
}

function mergeDirty(a: DirtyCellBounds, b: DirtyCellBounds): DirtyCellBounds {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minZ: Math.min(a.minZ, b.minZ),
    maxZ: Math.max(a.maxZ, b.maxZ),
  };
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

function enqueueParentsForLod0(coords: readonly [number, number][]): void {
  enqueueParentsForChildren(0, coords);
}

function nextPendingParent(): { level: number; key: string } | null {
  for (let level = 1; level <= topLevel; level++) {
    const set = pendingByLevel.get(level);
    if (!set || set.size === 0) continue;
    const key = set.values().next().value as string;
    set.delete(key);
    return { level, key };
  }
  return null;
}

function drainParents(budgetMs: number): void {
  if (!cfg || !index) return;
  const startedAt = performance.now();
  const changed: ClodPageNode[] = [];

  while (pendingParentCount() > 0 && performance.now() - startedAt < budgetMs) {
    const next = nextPendingParent();
    if (!next) break;
    const t0 = performance.now();
    const node = resimplifyParent(index, next.level, next.key, cfg);
    parentMs += performance.now() - t0;
    if (!node) continue;
    parentNodes++;
    changed.push(node);
    const [nx, nz] = next.key.split(",").map(Number) as [number, number];
    enqueueParentsForChildren(next.level, [[nx, nz]]);
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

  if (pendingParentCount() === 0 && activeParentRequestId !== null) {
    post({
      type: "parentsComplete",
      requestId: activeParentRequestId,
      parentNodes,
      parentMs,
    });
    activeParentRequestId = null;
    parentNodes = 0;
    parentMs = 0;
  }
}

function scheduleParentDrain(): void {
  if (drainScheduled) return;
  drainScheduled = true;
  setTimeout(() => {
    drainScheduled = false;
    try {
      drainParents(8);
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
        const key = `${px >> 1},${pz >> 1}`;
        const previous = groups.get(key);
        groups.set(key, previous ? mergeDirty(previous, dirty) : { ...dirty });
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
  if (pendingParentCount() > 0 && activeParentRequestId === null) activeParentRequestId = requestIds[0]!;

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
    pendingParents: pendingParentCount(),
  }, transferables);

  if (pendingParentCount() > 0) scheduleParentDrain();
}

function handleDig(request: Extract<ClodWorkerRequest, { type: "dig" }>): void {
  if (!result || !cfg || !index) throw new Error("CLOD worker received a dig before build completion");
  for (const edit of request.edits) addDigEdit(edit);
  postLod0Rebuild([request.requestId], request.dirtyRegions, request.edits.length);
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
