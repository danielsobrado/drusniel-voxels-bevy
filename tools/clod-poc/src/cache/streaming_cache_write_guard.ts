import type { ClodCacheStoredRecord } from "./cacheTypes.js";
import type { CacheRpcRequest } from "./cacheWorkerRpc.js";
import { CacheUnavailableError } from "./cacheErrors.js";
import { terrainStreamingGenerationIsCurrent } from "../stream/terrain_streaming_control.js";

export interface CacheWriteStore {
  put(key: string, record: ClodCacheStoredRecord): Promise<void>;
  deleteIfMatches(key: string, record: ClodCacheStoredRecord): Promise<boolean>;
  /** Optional: used to force-remove an orphan when conditional delete misses our write. */
  get?(key: string): Promise<ClodCacheStoredRecord | null>;
  delete?(key: string): Promise<void>;
}

type CachePutRequest = Extract<CacheRpcRequest, { op: "put" }>;

function requestCanCommit(request: CachePutRequest, nowUnixMs: number): boolean {
  if (!Number.isFinite(request.deadlineUnixMs) || nowUnixMs > request.deadlineUnixMs) return false;
  const generation = request.streamingGeneration;
  return generation === undefined || terrainStreamingGenerationIsCurrent(generation);
}

export async function commitCachePut(
  store: CacheWriteStore,
  request: CachePutRequest,
  nowUnixMs: () => number = Date.now,
): Promise<boolean> {
  if (!requestCanCommit(request, nowUnixMs())) return false;

  await store.put(request.key, request.record);
  if (requestCanCommit(request, nowUnixMs())) return true;

  const removed = await store.deleteIfMatches(request.key, request.record);
  if (removed) return false;

  // Conditional delete missed: either a newer write won, or our record is still orphaned.
  if (store.get) {
    const current = await store.get(request.key);
    if (!current || !cacheRecordVersionMatches(current, request.record)) {
      return false;
    }
    if (store.delete) {
      await store.delete(request.key);
      return false;
    }
  }

  throw new CacheUnavailableError(
    `cache put rollback failed for ${request.key}; orphaned write may remain`,
  );
}

export function cacheRecordVersionMatches(
  left: ClodCacheStoredRecord,
  right: ClodCacheStoredRecord,
): boolean {
  return left.header.key === right.header.key
    && left.header.createdAtUnixMs === right.header.createdAtUnixMs
    && left.header.checksum === right.header.checksum
    && left.header.sourceHash === right.header.sourceHash
    && left.header.metadata.cacheWriteId === right.header.metadata.cacheWriteId
    && left.header.metadata.terrainStreamingGeneration
      === right.header.metadata.terrainStreamingGeneration
    && left.header.metadata.terrainStreamingWriteId
      === right.header.metadata.terrainStreamingWriteId;
}
