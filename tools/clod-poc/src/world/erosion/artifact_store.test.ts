import { indexedDB } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { createErosionArtifact } from "./artifact_codec.js";
import { EROSION_SCHEMA_VERSION } from "./constants.js";
import { EROSION_ARTIFACT_STORE_NAME, IndexedDbErosionArtifactStore, openErosionArtifactDb } from "./artifact_store.js";
import type { ErodedMacroField, ErosionGpuCheckpoint } from "./types.js";

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

function gpuCheckpoint(): ErosionGpuCheckpoint {
  const width = 2;
  const height = 2;
  const stateAByteLength = width * height * 7 * Uint32Array.BYTES_PER_ELEMENT;
  return {
    kind: "gpu",
    schemaVersion: EROSION_SCHEMA_VERSION,
    sourceTerrainHash: SOURCE_HASH,
    configHash: CONFIG_HASH,
    hydraulicIteration: 64,
    thermalIteration: 16,
    initial: {
      sourceWidth: 2,
      sourceHeight: 2,
      width,
      height,
      borderCells: 0,
      cellSizeM: 16,
      originX: 0,
      originZ: 0,
    },
    stateAByteLength,
    stateAChunks: [new Uint8Array(stateAByteLength).fill(7).buffer],
  };
}

async function readRecord(db: IDBDatabase): Promise<Record<string, unknown>> {
  const key = `${SOURCE_HASH}/${CONFIG_HASH}`;
  const transaction = db.transaction(EROSION_ARTIFACT_STORE_NAME, "readonly");
  const request = transaction.objectStore(EROSION_ARTIFACT_STORE_NAME).get(key);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as Record<string, unknown>);
    request.onerror = () => reject(request.error);
  });
}

async function writeRecord(db: IDBDatabase, record: Record<string, unknown>): Promise<void> {
  const key = `${SOURCE_HASH}/${CONFIG_HASH}`;
  const transaction = db.transaction(EROSION_ARTIFACT_STORE_NAME, "readwrite");
  transaction.objectStore(EROSION_ARTIFACT_STORE_NAME).put(record, key);
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

describe("erosion artifact store", () => {
  it("returns the same canonical hash and GPU timing metadata after a warm load", async () => {
    const name = `erosion-store-${crypto.randomUUID()}`;
    const db = await openErosionArtifactDb(indexedDB, name);
    const store = new IndexedDbErosionArtifactStore(db, SOURCE_HASH, CONFIG_HASH);
    const artifact = await createErosionArtifact({
      field: field(),
      sourceTerrainHash: SOURCE_HASH,
      configHash: CONFIG_HASH,
      buildMs: 12,
      samplingMs: 2,
      checkpointCount: 3,
      massErrorRatio: 0,
      gpuPassTimingsMs: { "erosion-rain": 1.25 },
      timestampQueriesSupported: true,
    });
    await store.save(artifact);
    const loaded = await store.load();
    expect(loaded?.ref.hash).toBe(artifact.ref.hash);
    expect(loaded?.gpuPassTimingsMs["erosion-rain"]).toBe(1.25);
    expect(loaded?.timestampQueriesSupported).toBe(true);
    expect(loaded?.samplingMs).toBe(2);
    store.close();
  });

  it("round-trips an exact state-A-only GPU checkpoint", async () => {
    const name = `erosion-checkpoint-${crypto.randomUUID()}`;
    const db = await openErosionArtifactDb(indexedDB, name);
    const store = new IndexedDbErosionArtifactStore(db, SOURCE_HASH, CONFIG_HASH);
    const checkpoint = gpuCheckpoint();
    await store.saveCheckpoint(checkpoint);
    const loaded = await store.loadGpuCheckpoint();
    expect(loaded?.hydraulicIteration).toBe(64);
    expect(loaded?.thermalIteration).toBe(16);
    expect(new Uint8Array(loaded!.stateAChunks[0]!)[0]).toBe(7);
    expect("stateBChunks" in loaded!).toBe(false);
    await store.clearCheckpoint();
    expect(await store.loadGpuCheckpoint()).toBeNull();
    store.close();
  });

  it("rejects obsolete v1 records", async () => {
    const name = `erosion-v1-${crypto.randomUUID()}`;
    const db = await openErosionArtifactDb(indexedDB, name);
    const store = new IndexedDbErosionArtifactStore(db, SOURCE_HASH, CONFIG_HASH);
    const artifact = await createErosionArtifact({
      field: field(),
      sourceTerrainHash: SOURCE_HASH,
      configHash: CONFIG_HASH,
      buildMs: 1,
      checkpointCount: 0,
      massErrorRatio: 0,
    });
    await store.save(artifact);
    const record = await readRecord(db);
    await writeRecord(db, {
      ...record,
      schemaVersion: 1,
      ref: { ...(record.ref as Record<string, unknown>), schemaVersion: 1 },
    });
    expect(await store.load()).toBeNull();
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
    const record = await readRecord(db);
    const bytes = (record.compressedBytes as ArrayBuffer).slice(0);
    new Uint8Array(bytes)[bytes.byteLength - 1] ^= 1;
    await writeRecord(db, { ...record, compressedBytes: bytes });
    expect(await store.load()).toBeNull();
    store.close();
  });
});
