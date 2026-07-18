import type { ClodCacheManifestEntry, ClodCacheStoredRecord } from "./cacheTypes.js";
import { DEFAULT_CACHE_RPC_TIMEOUT_MS } from "./cacheConstants.js";
import { CacheUnavailableError, CacheWriteRejectedError } from "./cacheErrors.js";
import type { PersistentCacheStore } from "./indexedDbStore.js";
import type { CacheRpcRequest, CacheRpcResponse } from "./cacheWorkerRpc.js";

interface PendingCacheRpc {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

let nextRequestId = 1;
const pending = new Map<number, PendingCacheRpc>();

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

function recordStreamingGeneration(record: ClodCacheStoredRecord): number | undefined {
  const generation = record.header.metadata.terrainStreamingGeneration;
  return typeof generation === "number" && Number.isInteger(generation) && generation >= 0
    ? generation
    : undefined;
}

type CacheRpcBody =
  | { op: "probe" }
  | { op: "get"; key: string }
  | {
      op: "put";
      key: string;
      record: ClodCacheStoredRecord;
      deadlineUnixMs: number;
      streamingGeneration?: number;
    }
  | { op: "delete"; key: string }
  | { op: "deleteIfMatches"; key: string; record: ClodCacheStoredRecord }
  | { op: "clear" }
  | { op: "keys" };

function rpc<T>(body: CacheRpcBody, timeoutMs: number): Promise<T> {
  const requestId = nextRequestId++;
  const request = { type: "cacheRpc", requestId, ...body } as CacheRpcRequest;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!pending.delete(requestId)) return;
      reject(new CacheUnavailableError(`cache RPC ${body.op} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    pending.set(requestId, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timeout,
    });
    try {
      (self as unknown as Worker).postMessage(request);
    } catch (error) {
      const requestState = pending.get(requestId);
      if (requestState) {
        pending.delete(requestId);
        clearTimeout(requestState.timeout);
      }
      reject(error instanceof Error ? error : new CacheUnavailableError(String(error)));
    }
  });
}

export function dispatchCacheRpcResponse(message: CacheRpcResponse): boolean {
  const pendingRequest = pending.get(message.requestId);
  if (!pendingRequest) return false;
  pending.delete(message.requestId);
  clearTimeout(pendingRequest.timeout);
  if (message.ok) pendingRequest.resolve(message.result);
  else pendingRequest.reject(new CacheUnavailableError(message.error));
  return true;
}

export function pendingCacheRpcCount(): number {
  return pending.size;
}

export class WorkerRemotePersistentStore implements PersistentCacheStore {
  constructor(private readonly timeoutMs = DEFAULT_CACHE_RPC_TIMEOUT_MS) {
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new CacheUnavailableError("cache RPC timeout must be a positive integer");
    }
  }

  async probe(): Promise<boolean> {
    try {
      return Boolean(await rpc<boolean>({ op: "probe" }, this.timeoutMs));
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<ClodCacheStoredRecord | null> {
    const result = await rpc<ClodCacheStoredRecord | null>({ op: "get", key }, this.timeoutMs);
    if (!result) return null;
    return normalizeRecord(result);
  }

  async put(key: string, record: ClodCacheStoredRecord): Promise<void> {
    const streamingGeneration = recordStreamingGeneration(record);
    const accepted = await rpc<boolean>({
      op: "put",
      key,
      record: normalizeRecord(record),
      deadlineUnixMs: Date.now() + this.timeoutMs,
      ...(streamingGeneration === undefined ? {} : { streamingGeneration }),
    }, this.timeoutMs);
    if (!accepted) {
      throw new CacheWriteRejectedError(`cache write rejected for ${key}`);
    }
  }

  async deleteIfMatches(key: string, record: ClodCacheStoredRecord): Promise<boolean> {
    return Boolean(await rpc<boolean>({
      op: "deleteIfMatches",
      key,
      record: normalizeRecord(record),
    }, this.timeoutMs));
  }

  async delete(key: string): Promise<void> {
    await rpc({ op: "delete", key }, this.timeoutMs);
  }

  async clear(): Promise<void> {
    await rpc({ op: "clear" }, this.timeoutMs);
  }

  async keys(): Promise<string[]> {
    const keys = await rpc<string[]>({ op: "keys" }, this.timeoutMs);
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
