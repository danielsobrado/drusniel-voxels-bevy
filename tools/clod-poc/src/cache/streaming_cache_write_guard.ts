import type { ClodCacheStoredRecord } from "./cacheTypes.js";
import type { CacheRpcRequest } from "./cacheWorkerRpc.js";
import { terrainStreamingGenerationIsCurrent } from "../stream/terrain_streaming_control.js";

export interface CacheWriteStore {
  put(key: string, record: ClodCacheStoredRecord): Promise<void>;
  deleteIfMatches(key: string, record: ClodCacheStoredRecord): Promise<boolean>;
}

type CachePutRequest = Extract<CacheRpcRequest, { op: "put" }>;

export async function commitCachePut(
  store: CacheWriteStore,
  request: CachePutRequest,
): Promise<boolean> {
  const generation = request.streamingGeneration;
  if (generation === undefined) {
    await store.put(request.key, request.record);
    return true;
  }
  if (!terrainStreamingGenerationIsCurrent(generation)) return false;

  await store.put(request.key, request.record);
  if (terrainStreamingGenerationIsCurrent(generation)) return true;

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
    && left.header.metadata.terrainStreamingGeneration
      === right.header.metadata.terrainStreamingGeneration;
}
