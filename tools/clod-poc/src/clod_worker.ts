import { initSimplifier } from "./clod/simplify.js";
import {
  buildNodeIndex,
  buildStandaloneClodRootNode,
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
  createEmptyStreamRootCacheStats,
  storeStreamRootNode,
  tryLoadStreamRootNode,
} from "./cache/clodStreamRootCache.js";
import {
  applyDigEditTransaction,
  baseSurfaceHeight,
  getVoxelOverlaySource,
  rollbackDigEditTransaction,
  replaceVoxelEdits,
  setVoxelOverlaySource,
  setTerrainFieldConfig,
  setTerrainSurfaceOverride,
} from "./terrain/terrain.js";
import { setTerrainFieldCoreConfig } from "./gpu/terrain_field_core.js";
import {
  collectBuildResultTransferables,
  collectNodeTransferables,
  cloneMesh,
  serializeBuildResult,
  serializeNodes,
  type ClodWorkerRequest,
  type SerializedHydrologyTerrain,
} from "./clod_worker_protocol.js";
import type { ClodPagesConfig } from "./config.js";
import type { ClodPageNode } from "./types.js";
import { inclusiveMaxBoundary, intersectDirty, mergeDirty } from "./clod_worker_dirty.js";
import {
  restoreLod0Nodes,
  restoreParentNodes,
  restoreParentQueue as restoreParentQueueState,
  snapshotLod0Node,
  snapshotParentNode,
  snapshotParentQueue as snapshotParentQueueState,
} from "./clod_worker_snapshots.js";
import type {
  CombinedLod0Rebuild,
  Lod0Snapshot,
  ParentNodeSnapshot,
  ParentQueueSnapshot,
} from "./clod_worker_types.js";
import {
  errorResponse,
  installBorderCoastRuntime,
  installWorkerTerrainOverride,
  postWorkerMessage,
  type ExtendedClodWorkerResponse,
} from "./clod_worker_runtime.js";
import type { StartupHeightfieldRaster } from "./terrain/startup_heightfield_raster.js";
import { buildHeightfieldTile } from "./world/heightfield_tiles/heightfield_tile.js";
import { buildCarvedHeightfieldTile } from "./world/heightfield_tiles/heightfield_tile_carve.js";
import { featureStampFieldFromStamps } from "./world/feature_stamps.js";
import { buildHeightfieldTileComplexity } from "./world/heightfield_tiles/heightfield_tile_complexity.js";
import { createGraphHydrologySampler, type GraphHydrologySampler, type GraphTerrainCarveConfig } from "./water/graph_hydrology.js";
import {
  CHANNEL_CORRIDOR_LOCK_MARGIN_M,
  createTracedHydrologyCarver,
  isNearTracedChannel,
} from "./water/infinite_hydrology.js";
import { setSimplifyCorridorLockQuery } from "./lock.js";
import {
  collectHeightfieldTileTransferables,
  type HeightfieldTileWorkerBuildRequest,
  type HeightfieldTileWorkerRequest,
} from "./world/heightfield_tiles/heightfield_tile_worker_protocol.js";

type ExtendedClodWorkerRequest = ClodWorkerRequest | HeightfieldTileWorkerRequest;

const ctx = self as unknown as {
  postMessage: (message: ExtendedClodWorkerResponse, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent<ExtendedClodWorkerRequest>) => void) | null;
};

let cfg: ClodPagesConfig | null = null;
let hydrologyTerrain: SerializedHydrologyTerrain | null = null;
let startupHeightfield: StartupHeightfieldRaster | null = null;
let graphHydrology: GraphHydrologySampler | null = null;
let graphCarve: GraphTerrainCarveConfig | null = null;
let tracedCarver: ReturnType<typeof createTracedHydrologyCarver> | null = null;
let featureStampField: ReturnType<typeof featureStampFieldFromStamps> | null = null;
let workerCacheCtx: ClodCacheContext | null = null;
let result: BuildResult | null = null;
let index: NodeIndex | null = null;
let topLevel = 0;
let activeParentRequestId: number | null = null;
let parentNodes = 0;
let parentMs = 0;
let drainScheduled = false;

function graphFeatureHeight(x: number, z: number): number {
  if (!graphHydrology || !graphCarve) return baseSurfaceHeight(x, z);
  const carved = graphHydrology.carveHeight(x, z, baseSurfaceHeight(x, z), graphCarve);
  return Math.fround(featureStampField?.sampleHeight(x, z, carved) ?? carved);
}

// Streamed-world analogue of graphFeatureHeight: traced-channel carve over the base
// field. Stamps stay out on purpose — the streamed-world override never composed them
// (they belong to the heightfield tile authority), and the startup raster this function
// backs must agree with the raster the main thread bakes with the same carve-only rule.
function tracedFeatureHeight(x: number, z: number): number {
  if (!tracedCarver || !graphCarve) return baseSurfaceHeight(x, z);
  return tracedCarver.carveHeight(x, z, baseSurfaceHeight(x, z), graphCarve);
}
const pendingByLevel = new Map<number, Set<string>>();
/** Child page coords resimplified at level L; flushed to enqueue level L+1 once level L drains. */
const pendingChildCoordsByLevel = new Map<number, [number, number][]>();

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

function snapshotParentQueue(): ParentQueueSnapshot {
  return snapshotParentQueueState({
    pendingByLevel,
    pendingChildCoordsByLevel,
    activeParentRequestId,
    parentNodes,
    parentMs,
  });
}

function restoreParentQueue(snapshot: ParentQueueSnapshot): void {
  restoreParentQueueState(snapshot, {
    pendingByLevel,
    pendingChildCoordsByLevel,
    setActiveParentRequestId: (value) => { activeParentRequestId = value; },
    setParentNodes: (value) => { parentNodes = value; },
    setParentMs: (value) => { parentMs = value; },
  });
}

function post(message: ExtendedClodWorkerResponse, transfer?: Transferable[]): void {
  postWorkerMessage(ctx, message, transfer);
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

async function handleBuild(request: Extract<ClodWorkerRequest, { type: "build" }>): Promise<void> {
  cfg = request.cfg;
  setTerrainFieldConfig(request.terrainFieldConfig ?? null);
  setTerrainFieldCoreConfig(request.terrainFieldConfig ?? null);
  replaceVoxelEdits(request.voxelEdits);
  setVoxelOverlaySource(request.terrainSource.voxelOverlay);
  hydrologyTerrain = request.hydrologyTerrain ?? null;
  startupHeightfield = request.startupHeightfield ?? null;
  graphHydrology = request.hydrologyGraph
    ? createGraphHydrologySampler(request.hydrologyGraph, { surfaceHeight: baseSurfaceHeight })
    : null;
  graphCarve = request.hydrologyCarve ?? null;
  // One shared sampler object keeps the traced channel/basin memos (WeakMap-keyed per
  // sampler) warm across the carver and the corridor-lock query.
  const tracedSampler = { surfaceHeight: baseSurfaceHeight };
  tracedCarver = !request.hydrologyGraph && request.hydrologyCarve
    ? createTracedHydrologyCarver(tracedSampler)
    : null;
  // Traced worlds lock river-corridor vertices during parent simplification so the
  // carved channel survives coarse LODs the same way page borders do.
  setSimplifyCorridorLockQuery(tracedCarver
    ? (x, z) => isNearTracedChannel(x, z, tracedSampler, CHANNEL_CORRIDOR_LOCK_MARGIN_M)
    : null);
  featureStampField = request.featureStamps ? featureStampFieldFromStamps(request.featureStamps) : null;
  installWorkerTerrainOverride(startupHeightfield, hydrologyTerrain, {}, tracedCarver ? tracedFeatureHeight : undefined);
  if (!startupHeightfield && graphHydrology && graphCarve) {
    setTerrainSurfaceOverride(graphFeatureHeight);
  }
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
  const chunkPatches = new Map<string, CombinedLod0Rebuild["chunkPatches"][number]>();
  let fullPageFallbacks = 0;
  let pageWeldMs = 0;
  for (const dirty of pageParentDirtyGroups(regions)) {
    const partial = rebuildDirtyLod0Pages(result, dirty, cfg, index);
    lod0Ms += partial.lod0Ms;
    chunksRemeshed += partial.chunksRemeshed;
    chunksTotal += partial.chunksTotal;
    for (const patch of partial.chunkPatches) {
      const existing = chunkPatches.get(patch.nodeId);
      if (!existing) {
        chunkPatches.set(patch.nodeId, patch);
        continue;
      }
      const chunks = new Map(existing.chunks.map((chunk) => [chunk.localIndex, chunk]));
      for (const chunk of patch.chunks) chunks.set(chunk.localIndex, chunk);
      chunkPatches.set(patch.nodeId, {
        nodeId: patch.nodeId,
        revision: patch.revision,
        chunks: [...chunks.values()].sort((a, b) => a.localIndex - b.localIndex),
      });
    }
    fullPageFallbacks += partial.fullPageFallbacks;
    pageWeldMs += partial.pageWeldMs;
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
    chunkPatches: [...chunkPatches.values()],
    fullPageFallbacks,
    pageWeldMs,
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
  const chunkPatches = lod0.chunkPatches.map((patch) => ({
    nodeId: patch.nodeId,
    revision: patch.revision,
    chunks: patch.chunks.map(({ localIndex, mesh }) => ({ localIndex, mesh: cloneMesh(mesh) })),
  }));
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
  for (const patch of chunkPatches) {
    for (const chunk of patch.chunks) {
      serializedBytes += chunk.mesh.positions.byteLength
        + chunk.mesh.normals.byteLength
        + chunk.mesh.paintSlots.byteLength
        + chunk.mesh.materialWeights.byteLength
        + chunk.mesh.indices.byteLength;
      transferables.push(
        chunk.mesh.positions.buffer,
        chunk.mesh.normals.buffer,
        chunk.mesh.paintSlots.buffer,
        chunk.mesh.materialWeights.buffer,
        chunk.mesh.indices.buffer,
      );
    }
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
    chunkPatches,
    fullPageFallbacks: lod0.fullPageFallbacks,
    pageWeldMs: lod0.pageWeldMs,
  }, transferables);
}

function handleDig(request: Extract<ClodWorkerRequest, { type: "dig" }>): void {
  if (!result || !cfg || !index) throw new Error("CLOD worker received a dig before build completion");
  const lod0Snapshot = snapshotLod0Nodes(request.dirtyRegions);
  const parentQueueSnapshot = snapshotParentQueue();
  const applied = [] as typeof request.transactions;
  try {
    for (const transaction of request.transactions) {
      applyDigEditTransaction(transaction);
      applied.push(transaction);
    }
    postLod0Rebuild([request.requestId], request.dirtyRegions, request.transactions.length);
  } catch (error) {
    for (let i = applied.length - 1; i >= 0; i--) rollbackDigEditTransaction(applied[i]!);
    restoreLod0Nodes(lod0Snapshot);
    restoreParentQueue(parentQueueSnapshot);
    throw error;
  }
}

function streamRootLevel(level: number | undefined): number {
  if (!cfg) throw new Error("CLOD worker received buildStreamRoots before build completion");
  return Math.max(0, Math.min(cfg.page.quadtree_levels - 1, Math.floor(level ?? 0)));
}

function buildStreamRootNode(
  level: number,
  px: number,
  pz: number,
  world: { cellsX: number; cellsZ: number; finite: false },
): ClodPageNode {
  if (!cfg) throw new Error("CLOD worker received buildStreamRoots before build completion");
  if (graphHydrology && graphCarve) {
    setTerrainSurfaceOverride(graphFeatureHeight);
  } else {
    installWorkerTerrainOverride(
      startupHeightfield,
      hydrologyTerrain,
      { boundedToStartupWorld: true },
      tracedCarver ? tracedFeatureHeight : undefined,
    );
  }
  try {
    return buildStandaloneClodRootNode(level, px, pz, cfg, world);
  } finally {
    installWorkerTerrainOverride(startupHeightfield, hydrologyTerrain, {}, tracedCarver ? tracedFeatureHeight : undefined);
  }
}

async function handleBuildStreamRoots(request: Extract<ClodWorkerRequest, { type: "buildStreamRoots" }>): Promise<void> {
  if (!result || !cfg) throw new Error("CLOD worker received buildStreamRoots before build completion");
  const pageSpan = cfg.page.chunks_per_page * cfg.page.chunk_size;
  const worldCellsX = result.worldPagesX * pageSpan;
  const worldCellsZ = result.worldPagesZ * pageSpan;
  const world = { cellsX: worldCellsX, cellsZ: worldCellsZ, finite: false as const };
  const t0 = performance.now();
  const cacheStats = createEmptyStreamRootCacheStats();
  const nodes: ClodPageNode[] = [];

  for (const { px, pz, level } of request.coords) {
    const rootLevel = streamRootLevel(level);
    const nodeId = `L${rootLevel}:${px},${pz}`;
    const bypassCache = request.bypassCacheIds?.includes(nodeId) ?? false;
    const cached = bypassCache ? null : await tryLoadStreamRootNode(workerCacheCtx, "cpu", rootLevel, px, pz, cacheStats);
    if (cached) {
      nodes.push(cached);
      continue;
    }

    const buildStart = performance.now();
    const node = buildStreamRootNode(rootLevel, px, pz, world);
    const buildMs = performance.now() - buildStart;
    nodes.push(node);
    if (!bypassCache) await storeStreamRootNode(workerCacheCtx, "cpu", node, buildMs, cacheStats);
  }
  if (workerCacheCtx) await workerCacheCtx.service.flush();

  const serialized = serializeNodes(nodes);
  const transferables: Transferable[] = [];
  let transferBytes = 0;
  for (const node of serialized) {
    transferBytes += node.mesh.positions.byteLength
      + node.mesh.normals.byteLength
      + node.mesh.paintSlots.byteLength
      + node.mesh.materialWeights.byteLength
      + node.mesh.indices.byteLength;
    collectNodeTransferables(node, transferables);
  }
  post({
    type: "streamRootsBuilt",
    requestId: request.requestId,
    nodes: serialized,
    buildMs: performance.now() - t0,
    transferBytes,
    cacheStats,
  }, transferables);
}

function handleBuildHeightfieldTiles(request: HeightfieldTileWorkerBuildRequest): void {
  if (!result || !cfg) throw new Error("CLOD worker received buildHeightfieldTiles before build completion");
  if (request.keys.length === 0) {
    post({ type: "heightfieldTilesBuilt", requestId: request.requestId, tiles: [], buildMs: 0, transferBytes: 0 });
    return;
  }
  if (request.keys.length > 2) throw new Error("heightfield tile worker batches are limited to 2 tiles");

  const startedAt = performance.now();
  const features = request.featureStamps ? featureStampFieldFromStamps(request.featureStamps) : undefined;
  featureStampField = features ?? null;
  const tiles = request.keys.map((key) => {
    const field = {
      sampleHeight: baseSurfaceHeight,
      sourceRevision: request.sourceRevision,
      complexity: buildHeightfieldTileComplexity(key, getVoxelOverlaySource()),
    };
    const carver = graphHydrology ?? tracedCarver;
    if (carver && graphCarve) {
      return buildCarvedHeightfieldTile(key, field, carver, graphCarve, request.sourceRevision, features);
    }
    return buildHeightfieldTile(key, features ? {
      ...field,
      sampleHeight: (x, z) => features.sampleHeight(x, z, field.sampleHeight(x, z)),
    } : field, request.sourceRevision);
  });
  const transferBytes = tiles.reduce((sum, tile) => sum + tile.heights.byteLength
    + (tile.complexVolumeMask?.byteLength ?? 0) + (tile.entranceMask?.byteLength ?? 0), 0);
  post({
    type: "heightfieldTilesBuilt",
    requestId: request.requestId,
    tiles,
    buildMs: performance.now() - startedAt,
    transferBytes,
  }, collectHeightfieldTileTransferables(tiles));
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

ctx.onmessage = (event: MessageEvent<ExtendedClodWorkerRequest>) => {
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
    } else if (request.type === "buildStreamRoots") {
      void handleBuildStreamRoots(request).catch((error) => post(errorResponse(request.requestId, error)));
    } else if (request.type === "buildHeightfieldTiles") {
      handleBuildHeightfieldTiles(request);
    } else {
      handleFlush(request);
    }
  } catch (error) {
    post(errorResponse("requestId" in request ? request.requestId : null, error));
  }
};
