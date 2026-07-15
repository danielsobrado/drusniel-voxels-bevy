import { indexedDB } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { createErosionArtifact } from "./artifact_codec.js";
import { EROSION_ARTIFACT_STORE_NAME, IndexedDbErosionArtifactStore, openErosionArtifactDb } from "./artifact_store.js";
import type { ErodedMacroField } from "./types.js";

const SOURCE_HASH = "61".repeat(32);
const CONFIG_HASH = "72".repeat(32);

function field(): ErodedMacroField {
  const result: ErodedMacroField = {
    width: 2,
    height: 2,
    cellSizeM: 16,
    originX: 0,
    originZ: 0,
    heightFixed: Int32Array.from([256, 512, 768, 1024]),
    hardness: Uint16Array.from([1000, 2000, 3000, 4000]),
    sediment: Uint32Array.from([10, 20, 30, 40]),
    deposition: Int32Array.from([-10, -20, 30, 40]),
    sampleHeightMeters: () => 0,
  };
  return result;
}

describe("erosion artifact store", () => {
  it("returns the same canonical hash after a warm load", async () => {
    const name = `erosion-store-${crypto.randomUUID()}`;
    const db = await openErosionArtifactDb(indexedDB, name);
    const store = new IndexedDbErosionArtifactStore(db, SOURCE_HASH, CONFIG_HASH);
    const artifact = await createErosionArtifact({
      field: field(),
      sourceTerrainHash: SOURCE_HASH,
      configHash: CONFIG_HASH,
      buildMs: 12,
      checkpointCount: 3,
      massErrorRatio: 0,
    });
    await store.save(artifact);
    const loaded = await store.load();
    expect(loaded?.ref.hash).toBe(artifact.ref.hash);
    store.close();
  });

  it("detects and removes a corrupted persisted artifact", async () => {
    const name = `erosion-corrupt-${crypto.randomUUID()}`;
    const db = await openErosionArtifactDb(indexedDB, name);
    const store = new IndexedDbErosionArtifactStore(db, SOURCE_HASH, CONFIG_HASH);
    const artifact = await createErosionArtifact({
      field: field(),
      sourceTerrainHash: SOURCE_HASH,
      configHash: CONFIG_HASH,
      buildMs: 12,
      checkpointCount: 3,
      massErrorRatio: 0,
    });
    await store.save(artifact);
    const key = `${SOURCE_HASH}/${CONFIG_HASH}`;
    const readTransaction = db.transaction(EROSION_ARTIFACT_STORE_NAME, "readonly");
    const request = readTransaction.objectStore(EROSION_ARTIFACT_STORE_NAME).get(key);
    const record = await new Promise<Record<string, unknown>>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as Record<string, unknown>);
      request.onerror = () => reject(request.error);
    });
    const bytes = (record.compressedBytes as ArrayBuffer).slice(0);
    new Uint8Array(bytes)[bytes.byteLength - 1] ^= 1;
    const writeTransaction = db.transaction(EROSION_ARTIFACT_STORE_NAME, "readwrite");
    writeTransaction.objectStore(EROSION_ARTIFACT_STORE_NAME).put({ ...record, compressedBytes: bytes }, key);
    await new Promise<void>((resolve, reject) => {
      writeTransaction.oncomplete = () => resolve();
      writeTransaction.onerror = () => reject(writeTransaction.error);
    });
    expect(await store.load()).toBeNull();
    store.close();
  });
});
