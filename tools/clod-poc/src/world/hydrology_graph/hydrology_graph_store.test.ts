import { indexedDB } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { createHydrologyGraphArtifact } from "./hydrology_graph_artifact.js";
import { buildHydrologyGraph } from "./hydrology_graph_builder.js";
import {
  HYDROLOGY_GRAPH_STORE_NAME,
  IndexedDbHydrologyGraphStore,
  openHydrologyGraphDb,
} from "./hydrology_graph_store.js";

function dbName(): string { return `hydrology-graph-${Date.now()}-${Math.random()}`; }

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function artifact() {
  return createHydrologyGraphArtifact(buildHydrologyGraph({
    worldId: "store",
    seed: 9,
    sizeM: { x: 16, z: 16 },
    sampleHeight: (x, z) => x + z,
    config: { spacingM: 2, channelThresholdCells: 3 },
  }), 4);
}

describe("IndexedDbHydrologyGraphStore", () => {
  it("round-trips and verifies graph artifacts", async () => {
    const db = await openHydrologyGraphDb(indexedDB, dbName());
    const store = new IndexedDbHydrologyGraphStore(db, "terrain-a", "params-a");
    const source = await artifact();
    await store.save(source);
    const loaded = await store.load();
    expect(loaded?.ref).toEqual(source.ref);
    expect(loaded?.graph.macro.lakeIndex).toEqual(source.graph.macro.lakeIndex);
    expect(loaded?.graph.macro.lakeIndex).not.toBe(source.graph.macro.lakeIndex);
    expect(loaded?.graph.macro.buildFields).toBeUndefined();
    db.close();
  });

  it("namespaces by terrain and params hashes", async () => {
    const db = await openHydrologyGraphDb(indexedDB, dbName());
    const source = await artifact();
    await new IndexedDbHydrologyGraphStore(db, "terrain-a", "params-a").save(source);
    expect(await new IndexedDbHydrologyGraphStore(db, "terrain-b", "params-a").load()).toBeNull();
    expect(await new IndexedDbHydrologyGraphStore(db, "terrain-a", "params-b").load()).toBeNull();
    db.close();
  });

  it("treats corrupt records as cache misses", async () => {
    const db = await openHydrologyGraphDb(indexedDB, dbName());
    const transaction = db.transaction(HYDROLOGY_GRAPH_STORE_NAME, "readwrite");
    transaction.objectStore(HYDROLOGY_GRAPH_STORE_NAME).put(
      { schemaVersion: 2, terrainSourceHash: "terrain-a", graphParamsHash: "params-a" },
      "terrain-a/params-a",
    );
    await transactionDone(transaction);
    expect(await new IndexedDbHydrologyGraphStore(db, "terrain-a", "params-a").load()).toBeNull();
    db.close();
  });
});
