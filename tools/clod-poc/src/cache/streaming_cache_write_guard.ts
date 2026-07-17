import type { ClodCacheStoredRecord } from "./cacheTypes.js";
import type { CacheRpcRequest } from "./cacheWorkerRpc.js";
import { terrainStreamingGenerationIsCurrent } from "../stream/terrain_streaming_control.js";

export interface CacheWriteStore {
  get(key: string): Promise<ClodCacheStoredRecord | null>;
  put(key: string, record: ClodCacheStoredRecord): Promise<void>;
  delete(key: string): Promise<void>;
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

  const stored = await store.get(request.key);
  if (stored && sameRecordVersion(stored, request.record)) {
    await store.delete(request.key);
  }
  return false;
}

function sameRecordVersion(
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
