import cacheConfigText from "../../config/clod_cache.yaml?raw";
import { parseClodCacheConfig } from "./cacheConfig.js";
import { CacheUnavailableError } from "./cacheErrors.js";
import { cacheLogger } from "./cacheLogger.js";
import type { CacheRpcRequest, CacheRpcResponse } from "./cacheWorkerRpc.js";
import { isCacheRpcRequest } from "./cacheWorkerRpc.js";
import { CacheBrokerOperationQueue } from "./cacheBrokerOperationQueue.js";
import {
  IndexedDbStore,
  purgeLegacyCacheDatabases,
  resolveBrokerPersistentConfig,
} from "./indexedDbStore.js";
import { commitCachePut } from "./streaming_cache_write_guard.js";
import {
  registerTerrainStreamingWorker,
  terrainStreamingGenerationIsCurrent,
  type TerrainStreamingStateMessage,
} from "../stream/terrain_streaming_control.js";

type CacheWorker = {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  postMessage(message: CacheRpcResponse | TerrainStreamingStateMessage): void;
};

let brokerStore: IndexedDbStore | null = null;
let brokerInit: Promise<IndexedDbStore | null> | null = null;
const attachedWorkers = new WeakSet<CacheWorker>();
const brokerOperations = new CacheBrokerOperationQueue();

async function ensureBrokerStore(): Promise<IndexedDbStore | null> {
  if (brokerStore) return brokerStore;
  if (!brokerInit) {
    brokerInit = (async () => {
      const config = parseClodCacheConfig(cacheConfigText);
      if (!config.persistent.enabled || config.persistent.backend !== "indexeddb") return null;
      if (typeof indexedDB === "undefined") return null;
      await purgeLegacyCacheDatabases();
      const resolved = resolveBrokerPersistentConfig(config.persistent);
      const store = new IndexedDbStore(resolved);
      if (!(await store.probe())) {
        cacheLogger.warn("main-thread cache broker IndexedDB probe failed");
        return null;
      }
      brokerStore = store;
      cacheLogger.debug(`main-thread cache broker ready (db: ${resolved.database_name})`);
      return store;
    })();
  }
  return brokerInit;
}

function respondToCacheWorker(worker: CacheWorker, response: CacheRpcResponse): void {
  try {
    worker.postMessage(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    cacheLogger.debug(`cache broker response dropped: ${message}`);
  }
}

async function handleCacheRpc(worker: CacheWorker, request: CacheRpcRequest): Promise<void> {
  const respond = (response: CacheRpcResponse) => respondToCacheWorker(worker, response);
  try {
    if (request.op === "put"
      && request.streamingGeneration !== undefined
      && !terrainStreamingGenerationIsCurrent(request.streamingGeneration)) {
      respond({ type: "cacheRpc", requestId: request.requestId, ok: true, result: false });
      return;
    }

    const store = await ensureBrokerStore();
    if (!store) throw new CacheUnavailableError("main-thread cache broker unavailable");

    let result: unknown;
    switch (request.op) {
      case "probe":
        result = await store.probe();
        break;
      case "get":
        result = await store.get(request.key);
        break;
      case "put":
        result = await commitCachePut(store, request);
        break;
      case "delete":
        await store.delete(request.key);
        result = true;
        break;
      case "deleteIfMatches":
        result = await store.deleteIfMatches(request.key, request.record);
        break;
      case "clear":
        await store.clear();
        brokerStore = null;
        brokerInit = null;
        result = true;
        break;
      case "keys":
        result = await store.keys();
        break;
      default:
        throw new CacheUnavailableError("unknown cache RPC op");
    }
    respond({ type: "cacheRpc", requestId: request.requestId, ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    respond({ type: "cacheRpc", requestId: request.requestId, ok: false, error: message });
  }
}

function scheduleCacheRpc(worker: CacheWorker, request: CacheRpcRequest): Promise<void> {
  const operation = () => handleCacheRpc(worker, request);
  return request.op === "clear"
    ? brokerOperations.barrier(operation)
    : brokerOperations.run(operation);
}

/** Routes worker cache RPC to main-thread IndexedDB (workers skip local IDB). */
export function attachMainThreadCacheBroker(worker: CacheWorker): void {
  if (attachedWorkers.has(worker)) return;
  attachedWorkers.add(worker);
  registerTerrainStreamingWorker(worker);
  worker.addEventListener("message", (event: MessageEvent) => {
    const request = event.data;
    if (!isCacheRpcRequest(request)) return;
    void scheduleCacheRpc(worker, request);
  });
}

export function clearMainThreadCacheBroker(): Promise<void> {
  return brokerOperations.barrier(async () => {
    const store = await ensureBrokerStore();
    if (store) await store.clear();
    brokerStore = null;
    brokerInit = null;
  });
}
