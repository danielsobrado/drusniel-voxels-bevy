import type { ClodCachePersistentConfig } from "./cacheConfig.js";
import type { ClodCacheStoredRecord } from "./cacheTypes.js";
import { CacheUnavailableError } from "./cacheErrors.js";

const MANIFEST_KEY = "__manifest__";

export interface PersistentCacheStore {
  get(key: string): Promise<ClodCacheStoredRecord | null>;
  put(key: string, record: ClodCacheStoredRecord): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
}

export class InMemoryPersistentStore implements PersistentCacheStore {
  private readonly records = new Map<string, ClodCacheStoredRecord>();

  async get(key: string): Promise<ClodCacheStoredRecord | null> {
    return this.records.get(key) ?? null;
  }

  async put(key: string, record: ClodCacheStoredRecord): Promise<void> {
    this.records.set(key, record);
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key);
  }

  async clear(): Promise<void> {
    this.records.clear();
  }

  async keys(): Promise<string[]> {
    return [...this.records.keys()];
  }
}

export class IndexedDbStore implements PersistentCacheStore {
  private readonly config: ClodCachePersistentConfig;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(config: ClodCachePersistentConfig) {
    this.config = config;
  }

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    if (typeof indexedDB === "undefined") {
      return Promise.reject(new CacheUnavailableError("IndexedDB unavailable"));
    }
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.config.database_name, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.config.object_store_name)) {
          db.createObjectStore(this.config.object_store_name);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new CacheUnavailableError("IndexedDB open failed"));
    });
    return this.dbPromise;
  }

  private async withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.config.object_store_name, mode);
      const store = tx.objectStore(this.config.object_store_name);
      const request = fn(store);
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error ?? new CacheUnavailableError("IndexedDB request failed"));
    });
  }

  async get(key: string): Promise<ClodCacheStoredRecord | null> {
    const result = await this.withStore("readonly", (store) => store.get(key));
    return (result as ClodCacheStoredRecord | undefined) ?? null;
  }

  async put(key: string, record: ClodCacheStoredRecord): Promise<void> {
    await this.withStore("readwrite", (store) => store.put(record, key));
  }

  async delete(key: string): Promise<void> {
    await this.withStore("readwrite", (store) => store.delete(key));
  }

  async clear(): Promise<void> {
    await this.withStore("readwrite", (store) => store.clear());
  }

  async keys(): Promise<string[]> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.config.object_store_name, "readonly");
      const store = tx.objectStore(this.config.object_store_name);
      const request = store.getAllKeys();
      request.onsuccess = () => {
        const keys = (request.result as IDBValidKey[])
          .map(String)
          .filter((k) => k !== MANIFEST_KEY);
        resolve(keys);
      };
      request.onerror = () => reject(request.error ?? new CacheUnavailableError("IndexedDB keys failed"));
    });
  }
}

export function createPersistentStore(config: ClodCachePersistentConfig): PersistentCacheStore | null {
  if (!config.enabled) return null;
  if (config.backend === "indexeddb") {
    if (typeof indexedDB === "undefined") return null;
    return new IndexedDbStore(config);
  }
  // TODO: add Vite file-cache backend after IndexedDB behavior is validated.
  return null;
}
