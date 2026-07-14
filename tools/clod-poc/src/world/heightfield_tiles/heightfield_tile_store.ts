import {
  HEIGHTFIELD_TILE_RES,
  type HeightfieldTile,
} from "./heightfield_tile.js";
import type { HeightfieldTileStore } from "./heightfield_tile_cache.js";
import { tileKeyString, type WorldTileKey } from "../tile_key.js";

export const HEIGHTFIELD_TILE_DB_NAME = "drusniel-heightfield-tiles";
export const HEIGHTFIELD_TILE_DB_VERSION = 3;
export const HEIGHTFIELD_TILE_STORE_NAME = "heightfield_tiles";

interface HeightfieldTileRecord {
  schemaVersion: 2;
  terrainSourceHash: string;
  tileX: number;
  tileZ: number;
  tileKey: string;
  sourceRevision: number;
  res: number;
  builtMs: number;
  heights: ArrayBuffer;
  complexVolumeMask: ArrayBuffer | null;
  entranceMask: ArrayBuffer | null;
  voxelRegionRefs: string[];
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

function recordKey(terrainSourceHash: string, key: WorldTileKey, sourceRevision: number): string {
  return `${terrainSourceHash}/${sourceRevision}/${tileKeyString(key)}`;
}

function validRecord(
  value: unknown,
  terrainSourceHash: string,
  key: WorldTileKey,
  sourceRevision: number,
): value is HeightfieldTileRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<HeightfieldTileRecord>;
  return record.schemaVersion === 2
    && record.terrainSourceHash === terrainSourceHash
    && record.tileX === key.x
    && record.tileZ === key.z
    && record.tileKey === tileKeyString(key)
    && record.sourceRevision === sourceRevision
    && record.res === HEIGHTFIELD_TILE_RES
    && typeof record.builtMs === "number"
    && Number.isFinite(record.builtMs)
    && record.heights instanceof ArrayBuffer
    && record.heights.byteLength === HEIGHTFIELD_TILE_RES * HEIGHTFIELD_TILE_RES * Float32Array.BYTES_PER_ELEMENT
    && (record.complexVolumeMask === null || record.complexVolumeMask instanceof ArrayBuffer)
    && (record.entranceMask === null || record.entranceMask instanceof ArrayBuffer)
    && Array.isArray(record.voxelRegionRefs) && record.voxelRegionRefs.every((ref) => typeof ref === "string");
}

export async function openHeightfieldTileDb(
  factory: Pick<IDBFactory, "open"> = indexedDB,
  name = HEIGHTFIELD_TILE_DB_NAME,
): Promise<IDBDatabase> {
  const request = factory.open(name, HEIGHTFIELD_TILE_DB_VERSION);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(HEIGHTFIELD_TILE_STORE_NAME)) {
      request.result.createObjectStore(HEIGHTFIELD_TILE_STORE_NAME);
    }
  };
  return requestResult(request);
}

export class IndexedDbHeightfieldTileStore implements HeightfieldTileStore {
  constructor(
    private readonly db: IDBDatabase,
    private readonly terrainSourceHash: string,
  ) {
    if (!terrainSourceHash) throw new Error("heightfield tile terrainSourceHash is required");
  }

  async load(key: WorldTileKey, sourceRevision: number): Promise<HeightfieldTile | null> {
    const transaction = this.db.transaction(HEIGHTFIELD_TILE_STORE_NAME, "readonly");
    const value = await requestResult(
      transaction.objectStore(HEIGHTFIELD_TILE_STORE_NAME).get(
        recordKey(this.terrainSourceHash, key, sourceRevision),
      ),
    );
    await transactionDone(transaction);
    if (!validRecord(value, this.terrainSourceHash, key, sourceRevision)) return null;
    return {
      key: Object.freeze({ x: value.tileX, z: value.tileZ }),
      res: value.res,
      heights: new Float32Array(value.heights.slice(0)),
      complexVolumeMask: value.complexVolumeMask ? new Uint8Array(value.complexVolumeMask.slice(0)) : null,
      entranceMask: value.entranceMask ? new Uint8Array(value.entranceMask.slice(0)) : null,
      voxelRegionRefs: [...value.voxelRegionRefs],
      sourceRevision: value.sourceRevision,
      builtMs: value.builtMs,
    };
  }

  async save(tile: HeightfieldTile): Promise<void> {
    const record: HeightfieldTileRecord = {
      schemaVersion: 2,
      terrainSourceHash: this.terrainSourceHash,
      tileX: tile.key.x,
      tileZ: tile.key.z,
      tileKey: tileKeyString(tile.key),
      sourceRevision: tile.sourceRevision,
      res: tile.res,
      builtMs: tile.builtMs,
      heights: tile.heights.buffer.slice(
        tile.heights.byteOffset,
        tile.heights.byteOffset + tile.heights.byteLength,
      ) as ArrayBuffer,
      complexVolumeMask: tile.complexVolumeMask?.buffer.slice(
        tile.complexVolumeMask.byteOffset,
        tile.complexVolumeMask.byteOffset + tile.complexVolumeMask.byteLength,
      ) as ArrayBuffer | undefined ?? null,
      entranceMask: tile.entranceMask?.buffer.slice(
        tile.entranceMask.byteOffset,
        tile.entranceMask.byteOffset + tile.entranceMask.byteLength,
      ) as ArrayBuffer | undefined ?? null,
      voxelRegionRefs: [...tile.voxelRegionRefs],
    };
    const transaction = this.db.transaction(HEIGHTFIELD_TILE_STORE_NAME, "readwrite");
    transaction.objectStore(HEIGHTFIELD_TILE_STORE_NAME).put(
      record,
      recordKey(this.terrainSourceHash, tile.key, tile.sourceRevision),
    );
    await transactionDone(transaction);
  }

  close(): void {
    this.db.close();
  }
}
