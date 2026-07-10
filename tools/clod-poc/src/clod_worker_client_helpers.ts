import type { ClodPageNode } from "./types.js";
import { MAX_DIG_EDITS_PER_WORKER_BATCH } from "./clod_worker_client_types.js";
import type { ClodWorkerRequest, SerializedClodNode, SerializedParentBatch } from "./clod_worker_protocol.js";
import { applySerializedNode } from "./clod_worker_protocol.js";
import type { PendingRequest, DigBatchSlot, NodeTarget, WorkerParentBatch } from "./clod_worker_client_types.js";

export function postTrackedRequest<T>(
  requests: Map<number, PendingRequest<T>>,
  worker: Worker,
  request: ClodWorkerRequest,
): Promise<T> {
  return new Promise((resolve, reject) => {
    requests.set(request.requestId, { resolve, reject });
    try {
      worker.postMessage(request);
    } catch (error) {
      requests.delete(request.requestId);
      reject(error);
    }
  });
}

export function splitDigBatch(batch: DigBatchSlot): DigBatchSlot[] {
  if (batch.transactions.length <= MAX_DIG_EDITS_PER_WORKER_BATCH) return [batch];
  const out: DigBatchSlot[] = [];
  for (let start = 0; start < batch.transactions.length; start += MAX_DIG_EDITS_PER_WORKER_BATCH) {
    const end = Math.min(batch.transactions.length, start + MAX_DIG_EDITS_PER_WORKER_BATCH);
    out.push({
      transactions: batch.transactions.slice(start, end),
      dirtyRegions: batch.dirtyRegions.slice(start, end),
      resolvers: batch.resolvers.slice(start, end),
    });
  }
  return out;
}

export function sendDigBatchFn(
  batch: DigBatchSlot,
  worker: Worker,
  nextRequestId: () => number,
  digRequests: Map<number, PendingRequest<any>>,
  stopped: () => boolean,
  WORKER_STOPPED_ERROR: string,
): Promise<any> {
  if (stopped()) return Promise.reject(new Error(WORKER_STOPPED_ERROR));
  const requestId = nextRequestId();
  const request: ClodWorkerRequest = { type: "dig", requestId, transactions: batch.transactions, dirtyRegions: batch.dirtyRegions };
  return postTrackedRequest(digRequests, worker, request);
}

export function collectNodeTargets(
  nodes: readonly SerializedClodNode[],
  nodesById: Map<string, ClodPageNode>,
): NodeTarget[] {
  const targets = nodes.map((node) => {
    const target = nodesById.get(node.id);
    if (!target) throw new Error(`CLOD worker returned unknown node ${node.id}`);
    return { node, target };
  });
  for (const { node } of targets) {
    for (const childId of node.childIds) {
      if (childId !== null && !nodesById.has(childId)) {
        throw new Error(`CLOD worker returned node ${node.id} with unknown child ${childId}`);
      }
    }
  }
  return targets;
}

export function rehydrateParentBatch(
  message: SerializedParentBatch,
  nodesById: Map<string, ClodPageNode>,
): WorkerParentBatch {
  const targets = collectNodeTargets(message.changed, nodesById);
  return {
    requestId: message.requestId,
    changed: targets.map(({ node, target }) => applySerializedNode(target, node, nodesById)),
    parentNodes: message.parentNodes,
    parentMs: message.parentMs,
    pendingParents: message.pendingParents,
  };
}

export function rejectAllMaps(
  maps: Array<Map<number, PendingRequest<any>>>,
  progressHandlers: Map<number, (...args: any[]) => void>,
  error: Error,
): void {
  for (const map of maps) {
    for (const pending of map.values()) pending.reject(error);
    map.clear();
  }
  progressHandlers.clear();
}
