import { indexedDB } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { buildHeightfieldTile } from "./heightfield_tile.js";
import {
  HEIGHTFIELD_TILE_STORE_NAME,
  IndexedDbHeightfieldTileStore,
  openHeightfieldTileDb,
} from "./heightfield_tile_store.js";

function dbName(): string {
  return `heightfield-tiles-${Date.now()}-${Math.random()}`;
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

describe("IndexedDbHeightfieldTileStore", () => {
  it("round-trips f64 tile payloads", async () => {
    const db = await openHeightfieldTileDb(indexedDB, dbName());
    const store = new IndexedDbHeightfieldTileStore(db, "terrain-a");
    const source = buildHeightfieldTile({ x: -2, z: 3 }, { sampleHeight: (x, z) => x + z * 0.25 }, 7);

    await store.save(source);
    const loaded = await store.load(source.key, source.sourceRevision);

    expect(loaded).not.toBeNull();
    expect(loaded!.key).toEqual(source.key);
    expect(loaded!.sourceRevision).toBe(7);
    expect(loaded!.heights).toEqual(source.heights);
    expect(loaded!.heights).not.toBe(source.heights);
    db.close();
  });

  it("namespaces entries by terrain source hash", async () => {
    const db = await openHeightfieldTileDb(indexedDB, dbName());
    const tile = buildHeightfieldTile({ x: 0, z: 0 }, { sampleHeight: () => 2 }, 0);
    const first = new IndexedDbHeightfieldTileStore(db, "terrain-a");
    const second = new IndexedDbHeightfieldTileStore(db, "terrain-b");

    await first.save(tile);
    expect(await first.load(tile.key, 0)).not.toBeNull();
    expect(await second.load(tile.key, 0)).toBeNull();
    db.close();
  });

  it("treats corrupted entries as misses", async () => {
    const db = await openHeightfieldTileDb(indexedDB, dbName());
    const transaction = db.transaction(HEIGHTFIELD_TILE_STORE_NAME, "readwrite");
    transaction.objectStore(HEIGHTFIELD_TILE_STORE_NAME).put(
      { schemaVersion: 1, terrainSourceHash: "terrain-a", heights: new ArrayBuffer(8) },
      "terrain-a/0/T:0,0",
    );
    await transactionDone(transaction);

    const store = new IndexedDbHeightfieldTileStore(db, "terrain-a");
    expect(await store.load({ x: 0, z: 0 }, 0)).toBeNull();
    db.close();
  });
});
