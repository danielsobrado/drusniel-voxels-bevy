import type { ClodCachePersistentConfig } from "./cacheConfig.js";
import type { ClodCacheManifestEntry, ClodCacheStoredRecord } from "./cacheTypes.js";
import { CacheUnavailableError } from "./cacheErrors.js";
import { cacheLogger } from "./cacheLogger.js";
import { WorkerRemotePersistentStore } from "./workerRemotePersistentStore.js";

const DB_VERSION = 2;
const RECREATE_DELAY_MS = 150;
const MAX_IDB_RECOVERY_ATTEMPTS = 3;
const PAGE_CACHE_DB_SUFFIX = "pages-v2";
const SUMMARY_CACHE_DB_SUFFIX = "summary-v2";

/** IndexedDB-safe record: Uint8Array clones reliably in workers. */
interface IdbStoredRecord {
  header: ClodCacheStoredRecord["header"];
  payload: Uint8Array;
}

const LEGACY_DATABASE_NAMES = [
  "drusniel-clod-poc-cache",
  "drusniel-clod-poc-cache-worker",
  "drusniel-clod-poc-cache-pages",
];

export interface PersistentCacheStore {
  get(key: string): Promise<ClodCacheStoredRecord | null>;
  put(key: string, record: ClodCacheStoredRecord): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
  getManifestEntries(): Promise<ClodCacheManifestEntry[] | null>;
  putManifestEntries(entries: ClodCacheManifestEntry[]): Promise<void>;
  probe(): Promise<boolean>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toIdbRecord(record: ClodCacheStoredRecord): IdbStoredRecord {
  return {
    header: record.header,
    payload: new Uint8Array(record.payload),
  };
}

function fromIdbRecord(raw: IdbStoredRecord): ClodCacheStoredRecord {
  const bytes = new Uint8Array(raw.payload.byteLength);
  bytes.set(raw.payload);
  return { header: raw.header, payload: bytes.buffer };
}

function isRetryableIdbError(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  return error.name === "UnknownError"
    || error.name === "InvalidStateError"
    || error.name === "VersionError"
    || error.name === "NotReadableError"
    || error.name === "AbortError";
}

export function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      resolve();
      return;
    }
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new CacheUnavailableError(`deleteDatabase failed: ${name}`));
    request.onblocked = () => {
      cacheLogger.warn(`IndexedDB delete blocked for ${name}; waiting for open connections to close`);
    };
  });
}

export async function purgeLegacyCacheDatabases(): Promise<void> {
  for (const name of LEGACY_DATABASE_NAMES) {
    try {
      await deleteDatabase(name);
    } catch {
      // Best-effort cleanup of pre-v2 corrupted stores.
    }
  }
}

export class InMemoryPersistentStore implements PersistentCacheStore {
  private readonly records = new Map<string, ClodCacheStoredRecord>();
  private manifest: ClodCacheManifestEntry[] | null = null;

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
    this.manifest = null;
  }

  async keys(): Promise<string[]> {
    return [...this.records.keys()];
  }

  async getManifestEntries(): Promise<ClodCacheManifestEntry[] | null> {
    return this.manifest ? this.manifest.map((e) => ({ ...e })) : null;
  }

  async putManifestEntries(entries: ClodCacheManifestEntry[]): Promise<void> {
    this.manifest = entries.map((e) => ({ ...e }));
  }

  async probe(): Promise<boolean> {
    return true;
  }
}

export class IndexedDbStore implements PersistentCacheStore {
  private readonly config: ClodCachePersistentConfig;
  private db: IDBDatabase | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private recoveryAttempts = 0;

  get dbName(): string {
    return this.config.database_name;
  }

  private get objectStoreName(): string {
    return this.config.object_store_name;
  }

  constructor(config: ClodCachePersistentConfig) {
    this.config = config;
  }

  async probe(): Promise<boolean> {
    try {
      await this.withRecovery(() => this.probeInternal());
      return true;
    } catch (error) {
      const name = error instanceof DOMException ? error.name : error instanceof Error ? error.name : "";
      const message = error instanceof Error ? error.message : String(error);
      cacheLogger.warn(`IndexedDB probe failed [${name}] ${message} (db: ${this.dbName})`);
      return false;
    }
  }

  private closeConnection(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // Ignore close errors on corrupted connections.
      }
      this.db = null;
    }
    this.dbPromise = null;
  }

  private async recreateDatabase(): Promise<void> {
    this.closeConnection();
    await deleteDatabase(this.config.database_name);
    await purgeLegacyCacheDatabases();
    await delay(RECREATE_DELAY_MS);
  }

  private async withRecovery<T>(op: () => Promise<T>): Promise<T> {
    for (;;) {
      try {
        return await op();
      } catch (error) {
        if (!isRetryableIdbError(error) || this.recoveryAttempts >= MAX_IDB_RECOVERY_ATTEMPTS) throw error;
        this.recoveryAttempts++;
        cacheLogger.warn(
          `IndexedDB error [${(error as DOMException).name}], recreating db ${this.dbName} ` +
          `(attempt ${this.recoveryAttempts}/${MAX_IDB_RECOVERY_ATTEMPTS})`,
        );
        await this.recreateDatabase();
      }
    }
  }

  private openDbOnce(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") {
      return Promise.reject(new CacheUnavailableError("IndexedDB unavailable"));
    }
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.config.database_name, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        const storeName = this.objectStoreName;
        for (const name of Array.from(db.objectStoreNames)) {
          if (name !== storeName) db.deleteObjectStore(name);
        }
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          if (this.db === db) this.closeConnection();
        };
        this.db = db;
        resolve(db);
      };
      request.onerror = () => {
        const err = request.error;
        reject(err ?? new CacheUnavailableError(`${this.config.database_name} open failed`));
      };
    });
  }

  private async openDb(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = this.openDbOnce();
    try {
      this.db = await this.dbPromise;
      return this.db;
    } catch (error) {
      this.dbPromise = null;
      throw error;
    }
  }

  private async withArtifacts<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.objectStoreName, mode);
      const store = tx.objectStore(this.objectStoreName);
      const request = fn(store);
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error ?? new CacheUnavailableError("artifact store request failed"));
      tx.onerror = () => reject(tx.error ?? request.error ?? new CacheUnavailableError("artifact transaction failed"));
    });
  }

  private async probeInternal(): Promise<void> {
    await this.withArtifacts("readonly", (store) => store.count());
  }

  private async keysInternal(): Promise<string[]> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.objectStoreName, "readonly");
      const request = tx.objectStore(this.objectStoreName).getAllKeys();
      request.onsuccess = () => resolve((request.result as IDBValidKey[]).map(String));
      request.onerror = () => reject(request.error ?? new CacheUnavailableError("keys failed"));
      tx.onerror = () => reject(tx.error ?? new CacheUnavailableError("keys transaction failed"));
    });
  }

  async get(key: string): Promise<ClodCacheStoredRecord | null> {
    return this.withRecovery(async () => {
      const result = await this.withArtifacts("readonly", (store) => store.get(key));
      const raw = result as IdbStoredRecord | undefined;
      return raw ? fromIdbRecord(raw) : null;
    });
  }

  async put(key: string, record: ClodCacheStoredRecord): Promise<void> {
    await this.withRecovery(async () => {
      await this.withArtifacts("readwrite", (store) => store.put(toIdbRecord(record), key));
    });
  }

  async delete(key: string): Promise<void> {
    await this.withRecovery(async () => {
      await this.withArtifacts("readwrite", (store) => store.delete(key));
    });
  }

  async clear(): Promise<void> {
    await this.withRecovery(async () => {
      await this.withArtifacts("readwrite", (store) => store.clear());
    });
  }

  async keys(): Promise<string[]> {
    return this.withRecovery(() => this.keysInternal());
  }

  /** Manifest is memory-only for IndexedDB; cross-session eviction uses artifact headers on demand. */
  async getManifestEntries(): Promise<ClodCacheManifestEntry[] | null> {
    return null;
  }

  async putManifestEntries(_entries: ClodCacheManifestEntry[]): Promise<void> {
    // no-op: manifest not persisted to IndexedDB (avoids second-store failures in workers)
  }
}

export type CachePersistenceRole = "worker" | "main";

export function resolveBrokerPersistentConfig(
  config: ClodCachePersistentConfig | undefined,
): ClodCachePersistentConfig {
  if (!config) {
    throw new CacheUnavailableError("cache persistent config missing");
  }
  return {
    ...config,
    enabled: config.enabled,
    database_name: `${config.database_name}-${PAGE_CACHE_DB_SUFFIX}`,
  };
}

export function resolvePersistentConfig(
  config: ClodCachePersistentConfig,
  role: CachePersistenceRole,
): ClodCachePersistentConfig {
  if (role === "main") {
    return {
      ...config,
      enabled: config.enabled,
      database_name: `${config.database_name}-${SUMMARY_CACHE_DB_SUFFIX}`,
    };
  }
  // Worker never opens IndexedDB locally; persistence is brokered on the main thread.
  return { ...config, enabled: false };
}

export async function prepareWorkerPersistentStore(): Promise<void> {
  // Legacy DB cleanup runs on the main-thread broker before first open.
}

export function createPersistentStore(
  config: ClodCachePersistentConfig,
  role: CachePersistenceRole = "worker",
): PersistentCacheStore | null {
  const resolved = resolvePersistentConfig(config, role);
  if (role === "worker" && config.enabled && config.backend === "indexeddb") {
    if (typeof document === "undefined") {
      return new WorkerRemotePersistentStore();
    }
  }
  if (!resolved.enabled) return null;
  if (resolved.backend === "indexeddb") {
    if (typeof indexedDB === "undefined") return null;
    return new IndexedDbStore(resolved);
  }
  return null;
}
