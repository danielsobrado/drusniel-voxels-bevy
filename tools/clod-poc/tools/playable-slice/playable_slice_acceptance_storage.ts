import type { Page } from "playwright";
import { SAVE_DB_NAME, SAVE_DB_VERSION } from "../../src/save/save_db.js";
import {
  SAVE_CHUNK_SIZE_M,
  SAVE_PROCEDURAL_PROFILE,
  SAVE_REGION_SIZE_M,
  SAVE_SCHEMA_VERSION,
} from "../../src/save/save_config.js";
import type { WorldManifest } from "../../src/world/world_manifest.js";
import {
  PLAYABLE_SLICE_CONSTRUCTION_STORAGE_KEY,
  PLAYABLE_SLICE_SEED,
} from "./playable_slice_acceptance_environment.js";

export async function resetPlayableSliceStorageAndSeedSave(
  page: Page,
  saveId: string,
  worldManifest: WorldManifest,
): Promise<void> {
  if (worldManifest.seed !== PLAYABLE_SLICE_SEED) {
    throw new Error(
      `discovered world seed ${worldManifest.seed} does not match acceptance seed ${PLAYABLE_SLICE_SEED}`,
    );
  }

  await page.evaluate(async (input) => {
    localStorage.removeItem(input.constructionStorageKey);
    sessionStorage.clear();

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(input.dbName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("save database deletion failed"));
      request.onblocked = () => reject(new Error(`save database ${input.dbName} deletion was blocked`));
    });

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(input.dbName, input.dbVersion);
      request.onupgradeneeded = () => {
        for (const name of ["manifests", "regions", "metadata"]) {
          if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("save database open failed"));
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(["manifests", "metadata"], "readwrite");
        const now = new Date().toISOString();
        transaction.objectStore("manifests").put({
          schemaVersion: input.schemaVersion,
          saveId: input.saveId,
          worldId: input.worldManifest.worldId,
          seed: input.seed,
          proceduralProfile: input.proceduralProfile,
          regionSizeM: input.regionSizeM,
          chunkSizeM: input.chunkSizeM,
          regionKeys: [],
          createdAt: now,
          updatedAt: now,
          worldManifest: input.worldManifest,
        }, input.saveId);
        transaction.objectStore("metadata").put({
          schemaVersion: input.schemaVersion,
          cities: [],
          districts: [],
          roads: [],
          caveEntrances: [],
          caveSystems: [],
          criticalPaths: [],
          revision: 0,
        }, input.saveId);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("save seed transaction failed"));
        transaction.onabort = () => reject(transaction.error ?? new Error("save seed transaction aborted"));
      });
    } finally {
      db.close();
    }
  }, {
    constructionStorageKey: PLAYABLE_SLICE_CONSTRUCTION_STORAGE_KEY,
    dbName: SAVE_DB_NAME,
    dbVersion: SAVE_DB_VERSION,
    schemaVersion: SAVE_SCHEMA_VERSION,
    saveId,
    seed: PLAYABLE_SLICE_SEED,
    proceduralProfile: SAVE_PROCEDURAL_PROFILE,
    regionSizeM: SAVE_REGION_SIZE_M,
    chunkSizeM: SAVE_CHUNK_SIZE_M,
    worldManifest,
  });
}
