import cacheConfigText from "../../config/clod_cache.yaml?raw";
import { parseClodCacheConfig } from "./cacheConfig.js";
import { CacheUnavailableError } from "./cacheErrors.js";
import { cacheLogger } from "./cacheLogger.js";
import type { CacheRpcRequest, CacheRpcResponse } from "./cacheWorkerRpc.js";
import { isCacheRpcRequest } from "./cacheWorkerRpc.js";
import {
  IndexedDbStore,
  purgeLegacyCacheDatabases,
  resolveBrokerPersistentConfig,
} from "./indexedDbStore.js";

type CacheWorker = {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  postMessage(message: CacheRpcResponse): void;
};

let brokerStore: IndexedDbStore | null = null;
let brokerInit: Promise<IndexedDbStore | null> | null = null;
const attachedWorkers = new WeakSet<CacheWorker>();

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

async function handleCacheRpc(worker: CacheWorker, request: CacheRpcRequest): Promise<void> {
  const respond = (response: CacheRpcResponse) => worker.postMessage(response);
  try {
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
        await store.put(request.key, request.record);
        result = true;
        break;
      case "delete":
        await store.delete(request.key);
        result = true;
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

/** Routes worker cache RPC to main-thread IndexedDB (workers skip local IDB). */
export function attachMainThreadCacheBroker(worker: CacheWorker): void {
  if (attachedWorkers.has(worker)) return;
  attachedWorkers.add(worker);
  worker.addEventListener("message", (event: MessageEvent) => {
    if (!isCacheRpcRequest(event.data)) return;
    void handleCacheRpc(worker, event.data);
  });
}

export async function clearMainThreadCacheBroker(): Promise<void> {
  const store = await ensureBrokerStore();
  if (store) await store.clear();
  brokerStore = null;
  brokerInit = null;
}
