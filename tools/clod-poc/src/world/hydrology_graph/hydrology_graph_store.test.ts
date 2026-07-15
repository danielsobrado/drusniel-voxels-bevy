import { indexedDB } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { EROSION_SCHEMA_VERSION } from "../erosion/constants.js";
import type { ErosionArtifactRef, SerializedErodedMacroField } from "../erosion/types.js";
import { createHydrologyGraphArtifact } from "./hydrology_graph_artifact.js";
import { buildHydrologyGraphFromErodedMacro } from "./hydrology_graph_erosion.js";
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

function erosion(): { field: SerializedErodedMacroField; ref: ErosionArtifactRef } {
  const width = 9;
  const height = 9;
  const count = width * height;
  const heightFixed = new Int32Array(count);
  for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) heightFixed[z * width + x] = (x + z) * 512;
  const field = {
    width,
    height,
    cellSizeM: 2,
    originX: 0,
    originZ: 0,
    heightFixed,
    hardness: new Uint16Array(count).fill(32768),
    sediment: new Uint32Array(count),
    deposition: new Int32Array(count),
  };
  const ref: ErosionArtifactRef = {
    schemaVersion: EROSION_SCHEMA_VERSION,
    id: "erosion:test",
    hash: "12".repeat(32),
    width,
    height,
    cellSizeM: 2,
    originX: 0,
    originZ: 0,
    sourceTerrainHash: "34".repeat(32),
    configHash: "56".repeat(32),
  };
  return { field, ref };
}

async function artifact() {
  const source = erosion();
  return createHydrologyGraphArtifact(buildHydrologyGraphFromErodedMacro({
    worldId: "store",
    seed: 9,
    sizeM: { x: 16, z: 16 },
    config: { spacingM: 2, channelThresholdCells: 3 },
  }, source.field, source.ref), 4);
}

describe("IndexedDbHydrologyGraphStore", () => {
  it("round-trips and verifies graph and erosion artifacts", async () => {
    const db = await openHydrologyGraphDb(indexedDB, dbName());
    const store = new IndexedDbHydrologyGraphStore(db, "terrain-a", "params-a");
    const source = await artifact();
    await store.save(source);
    const loaded = await store.load();
    expect(loaded?.ref).toEqual(source.ref);
    expect(loaded?.graph.macro.lakeIndex).toEqual(source.graph.macro.lakeIndex);
    expect(loaded?.graph.macro.erosion?.artifactRef).toEqual(source.graph.macro.erosion?.artifactRef);
    expect(loaded?.graph.macro.erosion?.heightFixed).toEqual(source.graph.macro.erosion?.heightFixed);
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

  it("rejects obsolete v1 erosion authorities", async () => {
    const db = await openHydrologyGraphDb(indexedDB, dbName());
    const source = await artifact();
    const erosionAuthority = source.graph.macro.erosion!;
    const obsolete = {
      ...source,
      graph: {
        ...source.graph,
        macro: {
          ...source.graph.macro,
          erosion: {
            ...erosionAuthority,
            artifactRef: { ...erosionAuthority.artifactRef, schemaVersion: 1 as never },
          },
        },
      },
    };
    await expect(new IndexedDbHydrologyGraphStore(db, "terrain-a", "params-a").save(obsolete)).rejects.toThrow(/obsolete schema/);
    db.close();
  });

  it("treats corrupt records as cache misses", async () => {
    const db = await openHydrologyGraphDb(indexedDB, dbName());
    const transaction = db.transaction(HYDROLOGY_GRAPH_STORE_NAME, "readwrite");
    transaction.objectStore(HYDROLOGY_GRAPH_STORE_NAME).put(
      { schemaVersion: 4, terrainSourceHash: "terrain-a", graphParamsHash: "params-a" },
      "terrain-a/params-a",
    );
    await transactionDone(transaction);
    expect(await new IndexedDbHydrologyGraphStore(db, "terrain-a", "params-a").load()).toBeNull();
    db.close();
  });
});
