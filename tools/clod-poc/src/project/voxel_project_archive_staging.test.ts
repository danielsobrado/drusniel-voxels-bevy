import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  consumeStagedVoxelProjectImport,
  STAGED_PROJECT_IMPORT_MAX_AGE_MS,
} from "./voxel_project_archive.js";

const IMPORT_DB = "drusniel-clod-imports";
const IMPORT_STORE = "projects";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

async function putStagedRecord(token: string, createdAtMs: number): Promise<void> {
  const open = indexedDB.open(IMPORT_DB, 1);
  open.onupgradeneeded = () => open.result.createObjectStore(IMPORT_STORE);
  const db = await requestResult(open);
  try {
    const transaction = db.transaction(IMPORT_STORE, "readwrite");
    transaction.objectStore(IMPORT_STORE).put({
      manifest: { schemaVersion: 4 },
      customTextures: [],
      createdAtMs,
    }, token);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("transaction failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("transaction aborted"));
    });
  } finally {
    db.close();
  }
}

describe("staged project archive expiry", () => {
  beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
  afterEach(() => vi.unstubAllGlobals());

  it("deletes and rejects an abandoned staged import", async () => {
    const token = "expired-token";
    await putStagedRecord(token, 1_000);

    await expect(consumeStagedVoxelProjectImport(
      token,
      1_000 + STAGED_PROJECT_IMPORT_MAX_AGE_MS + 1,
    )).resolves.toBeNull();
    await expect(consumeStagedVoxelProjectImport(token, 1_001)).resolves.toBeNull();
  });
});
