import type { ClodCacheStoredRecord } from "./cacheTypes.js";
import type { CacheRpcRequest } from "./cacheWorkerRpc.js";
import { terrainStreamingGenerationIsCurrent } from "../stream/terrain_streaming_control.js";

export interface CacheWriteStore {
  put(key: string, record: ClodCacheStoredRecord): Promise<void>;
  deleteIfMatches(key: string, record: ClodCacheStoredRecord): Promise<boolean>;
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

  await store.deleteIfMatches(request.key, request.record);
  return false;
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
