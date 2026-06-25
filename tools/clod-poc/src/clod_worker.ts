import { initSimplifier } from "./clod/simplify.js";
import {
  buildNodeIndex,
  buildWorldAsync,
  rebuildDirtyLod0Pages,
  resimplifyParent,
  type BuildResult,
  type DirtyCellBounds,
  type NodeIndex,
} from "./clod/quadtree.js";
import { addDigEdit, replaceDigEdits, setTerrainSurfaceOverride } from "./terrain/terrain.js";
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

const ctx = self as unknown as {
  postMessage: (message: ClodWorkerResponse, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent<ClodWorkerRequest>) => void) | null;
};

let cfg: ClodPagesConfig | null = null;
let result: BuildResult | null = null;
let index: NodeIndex | null = null;
let topLevel = 0;
let activeParentRequestId: number | null = null;
let parentNodes = 0;
let parentMs = 0;
let drainScheduled = false;
const pendingByLevel = new Map<number, Set<string>>();

interface CoalescedDig {
  dirty: DirtyCellBounds;
  requestIds: number[];
}

let coalescedDig: CoalescedDig | null = null;

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
  ctx.postMessage(message, transfer);
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
  const changed = [];

  while (pendingParentCount() > 0 && performance.now() - startedAt < budgetMs) {
    const next = nextPendingParent();
    if (!next) break;
    const t0 = performance.now();
    const node = resimplifyParent(index, next.level, next.key, cfg);
    parentMs += performance.now() - t0;
    if (!node) continue;
    parentNodes++;
    changed.push(node);
    const [nx, nz] = next.key.split(",").map(Number);
    enqueueParent(next.level + 1, nx >> 1, nz >> 1);
  }

  if (changed.length > 0) {
    const serialized = serializeNodes(changed);
    const transferables: Transferable[] = [];
    for (const node of serialized) {
      collectNodeTransferables(node, transferables);
    }
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
    flushCoalescedDig();
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

async function handleBuild(request: Extract<ClodWorkerRequest, { type: "build" }>): Promise<void> {
  cfg = request.cfg;
  replaceDigEdits(request.edits);
  installHydrologyTerrain(request.hydrologyTerrain);
  pendingByLevel.clear();
  coalescedDig = null;
  activeParentRequestId = null;
  parentNodes = 0;
  parentMs = 0;
  await initSimplifier();
  result = await buildWorldAsync(
    request.worldPagesX,
    request.worldPagesZ,
    cfg,
    (progress) => post({ type: "progress", requestId: request.requestId, ...progress }),
  );
  index = buildNodeIndex(result);
  topLevel = Math.max(...result.nodesByLevel.keys());
  const serialized = serializeBuildResult(result);
  post({ type: "buildComplete", requestId: request.requestId, result: serialized }, collectBuildResultTransferables(serialized));
}

function queueCoalescedDig(requestId: number, dirty: DirtyCellBounds): void {
  if (!coalescedDig) {
    coalescedDig = { dirty: { ...dirty }, requestIds: [requestId] };
    return;
  }
  coalescedDig.dirty = mergeDirty(coalescedDig.dirty, dirty);
  coalescedDig.requestIds.push(requestId);
}

function postLod0Rebuild(requestIds: number[], dirty: DirtyCellBounds): void {
  if (!result || !cfg || !index) throw new Error("CLOD worker received a dig before build completion");
  if (requestIds.length === 0) return;

  const lod0 = rebuildDirtyLod0Pages(result, dirty, cfg, index);
  activeParentRequestId = requestIds[0]!;
  parentNodes = 0;
  parentMs = 0;
  for (const [nx, nz] of lod0.dirtyCoords) enqueueParent(1, nx >> 1, nz >> 1);

  const tSer = performance.now();
  const changed = serializeNodes(lod0.changed);
  const serializeMs = performance.now() - tSer;
  let serializedBytes = 0;
  const transferables: Transferable[] = [];
  for (const node of changed) {
    serializedBytes += node.mesh.positions.byteLength
      + node.mesh.normals.byteLength
      + node.mesh.paintSlots.byteLength
      + node.mesh.materialWeights.byteLength
      + node.mesh.indices.byteLength;
    transferables.push(
      node.mesh.positions.buffer,
      node.mesh.normals.buffer,
      node.mesh.paintSlots.buffer,
      node.mesh.materialWeights.buffer,
      node.mesh.indices.buffer,
    );
  }

  post({
    type: "lod0Rebuilt",
    requestIds,
    changed,
    dirtyCoords: lod0.dirtyCoords.map(([x, z]) => [x, z] as [number, number]),
    lod0Pages: lod0.lod0Pages,
    lod0Ms: lod0.lod0Ms,
    serializeMs,
    serializedBytes,
    chunksRemeshed: lod0.chunksRemeshed,
    chunksTotal: lod0.chunksTotal,
    pendingParents: pendingParentCount(),
  }, transferables);
  scheduleParentDrain();
}

function flushCoalescedDig(): void {
  if (!coalescedDig || pendingParentCount() > 0) return;
  const batch = coalescedDig;
  coalescedDig = null;
  postLod0Rebuild(batch.requestIds, batch.dirty);
}

function handleDig(request: Extract<ClodWorkerRequest, { type: "dig" }>): void {
  if (!result || !cfg || !index) throw new Error("CLOD worker received a dig before build completion");
  for (const edit of request.edits) addDigEdit(edit);

  if (pendingParentCount() > 0) {
    queueCoalescedDig(request.requestId, request.dirty);
    return;
  }

  postLod0Rebuild([request.requestId], request.dirty);
}

function handleFlush(request: Extract<ClodWorkerRequest, { type: "flush" }>): void {
  drainParents(Number.POSITIVE_INFINITY);
  flushCoalescedDig();
  post({ type: "flushed", requestId: request.requestId });
}

ctx.onmessage = (event: MessageEvent<ClodWorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === "build") {
      void handleBuild(request).catch((error) => post(errorResponse(request.requestId, error)));
    } else if (request.type === "dig") {
      handleDig(request);
    } else {
      handleFlush(request);
    }
  } catch (error) {
    post(errorResponse(request.requestId, error));
  }
};
