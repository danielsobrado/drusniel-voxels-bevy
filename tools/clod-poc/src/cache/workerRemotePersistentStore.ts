import type { ClodCacheManifestEntry, ClodCacheStoredRecord } from "./cacheTypes.js";
import { CacheUnavailableError } from "./cacheErrors.js";
import type { PersistentCacheStore } from "./indexedDbStore.js";
import type { CacheRpcRequest, CacheRpcResponse } from "./cacheWorkerRpc.js";

let nextRequestId = 1;
const pending = new Map<number, {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}>();

function normalizePayload(payload: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (payload instanceof ArrayBuffer) return payload;
  const view = payload as ArrayBufferView;
  const bytes = new Uint8Array(view.byteLength);
  bytes.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return bytes.buffer;
}

function normalizeRecord(record: ClodCacheStoredRecord): ClodCacheStoredRecord {
  return {
    header: record.header,
    payload: normalizePayload(record.payload),
  };
}

type CacheRpcBody =
  | { op: "probe" }
  | { op: "get"; key: string }
  | { op: "put"; key: string; record: ClodCacheStoredRecord }
  | { op: "delete"; key: string }
  | { op: "clear" }
  | { op: "keys" };

function rpc<T>(body: CacheRpcBody): Promise<T> {
  const requestId = nextRequestId++;
  const request = { type: "cacheRpc", requestId, ...body } as CacheRpcRequest;
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject });
    (self as unknown as Worker).postMessage(request);
  });
}

export function dispatchCacheRpcResponse(message: CacheRpcResponse): boolean {
  const pendingRequest = pending.get(message.requestId);
  if (!pendingRequest) return false;
  pending.delete(message.requestId);
  if (message.ok) pendingRequest.resolve(message.result);
  else pendingRequest.reject(new Error(message.error));
  return true;
}

export class WorkerRemotePersistentStore implements PersistentCacheStore {
  async probe(): Promise<boolean> {
    try {
      return Boolean(await rpc<boolean>({ op: "probe" }));
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<ClodCacheStoredRecord | null> {
    const result = await rpc<ClodCacheStoredRecord | null>({ op: "get", key });
    if (!result) return null;
    return normalizeRecord(result);
  }

  async put(key: string, record: ClodCacheStoredRecord): Promise<void> {
    await rpc({ op: "put", key, record: normalizeRecord(record) });
  }

  async delete(key: string): Promise<void> {
    await rpc({ op: "delete", key });
  }

  async clear(): Promise<void> {
    await rpc({ op: "clear" });
  }

  async keys(): Promise<string[]> {
    const keys = await rpc<string[]>({ op: "keys" });
    if (!Array.isArray(keys)) throw new CacheUnavailableError("cache keys RPC returned invalid payload");
    return keys;
  }

  async getManifestEntries(): Promise<ClodCacheManifestEntry[] | null> {
    return null;
  }

  async putManifestEntries(_entries: ClodCacheManifestEntry[]): Promise<void> {
    // Manifest is memory-only.
  }
}
