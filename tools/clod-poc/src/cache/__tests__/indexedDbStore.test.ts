import { describe, expect, it } from "vitest";
import {
  createPersistentStore,
  resolveBrokerPersistentConfig,
  resolvePersistentConfig,
} from "../indexedDbStore.js";
import { WorkerRemotePersistentStore } from "../workerRemotePersistentStore.js";

describe("persistent config roles", () => {
  const base = {
    enabled: true,
    backend: "indexeddb" as const,
    database_name: "drusniel-clod-poc-cache",
    object_store_name: "artifacts",
    max_items: 100,
    max_bytes: 1_000_000,
    compression: "none" as const,
    checksum: "sha256" as const,
  };

  it("disables persistence on main thread cache service", () => {
    const resolved = resolvePersistentConfig(base, "main");
    expect(resolved.enabled).toBe(false);
  });

  it("disables local worker IndexedDB (brokered on main thread)", () => {
    const resolved = resolvePersistentConfig(base, "worker");
    expect(resolved.enabled).toBe(false);
  });

  it("uses broker database name on main thread", () => {
    const resolved = resolveBrokerPersistentConfig(base);
    expect(resolved.enabled).toBe(true);
    expect(resolved.database_name).toBe("drusniel-clod-poc-cache-pages-v2");
  });

  it("createPersistentStore worker role does not throw on persistent config shape", () => {
    expect(() => createPersistentStore(base, "worker")).not.toThrow();
    const store = createPersistentStore(base, "worker");
    expect(store).toBeInstanceOf(WorkerRemotePersistentStore);
  });
});
