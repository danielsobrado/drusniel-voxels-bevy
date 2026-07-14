import type { SaveRegionRecords } from "./region_store.js";
import type { RegionVoxelDeltas, SaveWorldManifest, WorldMetadataRecord } from "./save_schema.js";
import { assertRegionManifest, assertRegionRecordSet, assertRegionVoxelDeltas, assertSaveWorldManifest, assertWorldMetadataRecord } from "./save_schema.js";
import { migrateSaveManifest } from "./save_migration.js";

export const SAVE_DB_NAME = "drusniel-clod-saves";
export const SAVE_DB_VERSION = 1;
export const SAVE_MANIFEST_STORE = "manifests";
export const SAVE_REGION_STORE = "regions";
export const SAVE_METADATA_STORE = "metadata";

export interface SaveDbWriteOptions {
  abortBeforeCommit?: boolean;
}

function manifestKey(saveId: string): string {
  return saveId;
}

function regionManifestKey(saveId: string, regionKey: string): string {
  return `${saveId}/${regionKey}`;
}

function voxelDeltasKey(saveId: string, regionKey: string): string {
  return `${saveId}/${regionKey}/voxel_deltas`;
}

function propsKey(saveId: string, regionKey: string): string {
  return `${saveId}/${regionKey}/props`;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function ensureStore(db: IDBDatabase, name: string): void {
  if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
}

function cloneVoxelDeltasRecord(voxelDeltas: RegionVoxelDeltas): RegionVoxelDeltas {
  if (voxelDeltas.format === "json") {
    return { ...voxelDeltas, deltas: voxelDeltas.deltas.map((delta) => ({ ...delta })) };
  }
  const payload = voxelDeltas.payload instanceof ArrayBuffer
    ? voxelDeltas.payload.slice(0)
    : voxelDeltas.payload.slice();
  return { ...voxelDeltas, payload };
}

export async function openSaveDb(factory: Pick<IDBFactory, "open"> = indexedDB, name = SAVE_DB_NAME): Promise<IDBDatabase> {
  const request = factory.open(name, SAVE_DB_VERSION);
  request.onupgradeneeded = () => {
    ensureStore(request.result, SAVE_MANIFEST_STORE);
    ensureStore(request.result, SAVE_REGION_STORE);
    ensureStore(request.result, SAVE_METADATA_STORE);
  };
  return requestResult(request);
}

export async function writeRegionRecords(
  db: IDBDatabase,
  saveId: string,
  records: SaveRegionRecords,
  options: SaveDbWriteOptions = {},
): Promise<void> {
  assertRegionManifest(records.manifest);
  assertRegionVoxelDeltas(records.voxelDeltas);
  assertRegionRecordSet(records.manifest, records.voxelDeltas, records.props);

  const transaction = db.transaction([SAVE_MANIFEST_STORE, SAVE_REGION_STORE], "readwrite");
  const manifests = transaction.objectStore(SAVE_MANIFEST_STORE);
  const regions = transaction.objectStore(SAVE_REGION_STORE);
  const regionKey = records.manifest.regionKey;

  manifests.put({ ...records.manifest }, regionManifestKey(saveId, regionKey));
  regions.put(cloneVoxelDeltasRecord(records.voxelDeltas), voxelDeltasKey(saveId, regionKey));
  regions.put(records.props.map((prop) => ({ ...prop, position: [...prop.position], rotation: [...prop.rotation], scale: [...prop.scale], tags: [...prop.tags], environmental: prop.environmental ? { ...prop.environmental, tileKey: { ...prop.environmental.tileKey } } : undefined })), propsKey(saveId, regionKey));

  if (options.abortBeforeCommit) transaction.abort();
  await transactionDone(transaction);
}

export async function readRegionRecords(db: IDBDatabase, saveId: string, regionKey: string): Promise<SaveRegionRecords | null> {
  const transaction = db.transaction([SAVE_MANIFEST_STORE, SAVE_REGION_STORE], "readonly");
  const manifests = transaction.objectStore(SAVE_MANIFEST_STORE);
  const regions = transaction.objectStore(SAVE_REGION_STORE);

  const manifestRequest = manifests.get(regionManifestKey(saveId, regionKey));
  const voxelRequest = regions.get(voxelDeltasKey(saveId, regionKey));
  const propsRequest = regions.get(propsKey(saveId, regionKey));
  const [manifest, voxelDeltas, props] = await Promise.all([
    requestResult(manifestRequest),
    requestResult(voxelRequest),
    requestResult(propsRequest),
  ]);
  await transactionDone(transaction);

  if (manifest === undefined && voxelDeltas === undefined && props === undefined) return null;
  assertRegionManifest(manifest);
  assertRegionVoxelDeltas(voxelDeltas);
  if (!Array.isArray(props)) throw new Error("saved region props must be an array");
  const records = { manifest, voxelDeltas, props } as SaveRegionRecords;
  assertRegionRecordSet(records.manifest, records.voxelDeltas, records.props);
  return records;
}

export async function writeSaveManifestAndMetadata(
  db: IDBDatabase,
  manifest: SaveWorldManifest,
  metadata: WorldMetadataRecord,
): Promise<void> {
  assertSaveWorldManifest(manifest);
  assertWorldMetadataRecord(metadata);
  const transaction = db.transaction([SAVE_MANIFEST_STORE, SAVE_METADATA_STORE], "readwrite");
  transaction.objectStore(SAVE_MANIFEST_STORE).put({ ...manifest, regionKeys: [...manifest.regionKeys] }, manifestKey(manifest.saveId));
  transaction.objectStore(SAVE_METADATA_STORE).put(structuredClone(metadata), manifest.saveId);
  await transactionDone(transaction);
}

export async function readSaveManifest(db: IDBDatabase, saveId: string): Promise<SaveWorldManifest | null> {
  const transaction = db.transaction(SAVE_MANIFEST_STORE, "readonly");
  const value = await requestResult(transaction.objectStore(SAVE_MANIFEST_STORE).get(manifestKey(saveId)));
  await transactionDone(transaction);
  if (value === undefined) return null;
  assertSaveWorldManifest(value);
  return migrateSaveManifest(value).manifest;
}

export async function readWorldMetadata(db: IDBDatabase, saveId: string): Promise<WorldMetadataRecord | null> {
  const transaction = db.transaction(SAVE_METADATA_STORE, "readonly");
  const value = await requestResult(transaction.objectStore(SAVE_METADATA_STORE).get(saveId));
  await transactionDone(transaction);
  if (value === undefined) return null;
  assertWorldMetadataRecord(value);
  return value;
}
