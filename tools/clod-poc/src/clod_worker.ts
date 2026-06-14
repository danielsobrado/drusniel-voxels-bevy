import { initSimplifier } from "./simplify.js";
import {
  buildNodeIndex,
  buildWorldAsync,
  rebuildDirtyLod0Pages,
  resimplifyParent,
  type BuildResult,
  type NodeIndex,
} from "./quadtree.js";
import { addDigEdit, replaceDigEdits } from "./terrain.js";
import {
  serializeBuildResult,
  serializeNodes,
  type ClodWorkerRequest,
  type ClodWorkerResponse,
} from "./clod_worker_protocol.js";
import type { ClodPagesConfig } from "./config.js";

const ctx = self as unknown as {
  postMessage: (message: ClodWorkerResponse) => void;
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

function post(message: ClodWorkerResponse): void {
  ctx.postMessage(message);
}

function errorResponse(requestId: number | null, error: unknown): ClodWorkerResponse {
  const err = error as Error & { kind?: string };
  return {
    type: "error",
    requestId,
    message: err?.message ?? String(error),
    name: err?.name,
    kind: err?.kind,
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
    post({
      type: "parentRebuilt",
      requestId: activeParentRequestId,
      changed: serializeNodes(changed),
      parentNodes,
      parentMs,
      pendingParents: pendingParentCount(),
    });
  }

  if (pendingParentCount() === 0 && activeParentRequestId !== null) {
    post({
      type: "parentsComplete",
      requestId: activeParentRequestId,
      parentNodes,
      parentMs,
    });
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
  pendingByLevel.clear();
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
  post({ type: "buildComplete", requestId: request.requestId, result: serializeBuildResult(result) });
}

function handleDig(request: Extract<ClodWorkerRequest, { type: "dig" }>): void {
  if (!result || !cfg || !index) throw new Error("CLOD worker received a dig before build completion");
  addDigEdit(request.edit);

  const lod0 = rebuildDirtyLod0Pages(result, request.dirty, cfg, index);
  activeParentRequestId = request.requestId;
  parentNodes = 0;
  parentMs = 0;
  for (const [nx, nz] of lod0.dirtyCoords) enqueueParent(1, nx >> 1, nz >> 1);

  post({
    type: "lod0Rebuilt",
    requestId: request.requestId,
    changed: serializeNodes(lod0.changed),
    dirtyCoords: lod0.dirtyCoords.map(([x, z]) => [x, z]),
    lod0Pages: lod0.lod0Pages,
    lod0Ms: lod0.lod0Ms,
    chunksRemeshed: lod0.chunksRemeshed,
    chunksTotal: lod0.chunksTotal,
    pendingParents: pendingParentCount(),
  });
  scheduleParentDrain();
}

function handleFlush(request: Extract<ClodWorkerRequest, { type: "flush" }>): void {
  drainParents(Number.POSITIVE_INFINITY);
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
