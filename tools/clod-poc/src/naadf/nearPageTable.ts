import type { ChunkKey } from "./types.js";
import { EMPTY_SLOT } from "./constants.js";

export type NearPageTable = {
  centerChunk: ChunkKey;
  radiusChunksXz: number;
  slots: Int32Array;
  epoch: number;
};

export function createNearPageTable(radiusChunksXz: number): NearPageTable {
  const diameter = radiusChunksXz * 2 + 1;
  const slotCount = diameter * diameter;
  return {
    centerChunk: { x: 0, z: 0 },
    radiusChunksXz,
    slots: new Int32Array(slotCount).fill(EMPTY_SLOT),
    epoch: 0,
  };
}

function slotIndex(
  table: NearPageTable,
  chunkX: number,
  chunkZ: number,
): number {
  const { centerChunk, radiusChunksXz } = table;
  const dx = chunkX - centerChunk.x;
  const dz = chunkZ - centerChunk.z;
  if (Math.abs(dx) > radiusChunksXz || Math.abs(dz) > radiusChunksXz) return -1;
  const diameter = radiusChunksXz * 2 + 1;
  const localX = dx + radiusChunksXz;
  const localZ = dz + radiusChunksXz;
  return localZ * diameter + localX;
}

export function nearPageTableLookup(
  table: NearPageTable,
  key: ChunkKey,
): number {
  const idx = slotIndex(table, key.x, key.z);
  if (idx < 0) return -1;
  return table.slots[idx]!;
}

export function nearPageTableInsert(
  table: NearPageTable,
  key: ChunkKey,
  chunkIndex: number,
): boolean {
  const idx = slotIndex(table, key.x, key.z);
  if (idx < 0) return false;
  table.slots[idx] = chunkIndex;
  return true;
}

export function isChunkInNearTable(table: NearPageTable, key: ChunkKey): boolean {
  return slotIndex(table, key.x, key.z) >= 0;
}

export function* enumerateNearTableChunks(
  center: ChunkKey,
  radiusChunksXz: number,
): Generator<ChunkKey> {
  for (let dz = -radiusChunksXz; dz <= radiusChunksXz; dz++) {
    for (let dx = -radiusChunksXz; dx <= radiusChunksXz; dx++) {
      yield { x: center.x + dx, z: center.z + dz };
    }
  }
}

export function recenterNearPageTable(
  table: NearPageTable,
  newCenter: ChunkKey,
  residents: ReadonlyArray<{ key: ChunkKey; index: number }>,
): void {
  table.centerChunk = { x: newCenter.x, z: newCenter.z };
  table.epoch++;
  table.slots.fill(EMPTY_SLOT);
  for (const { key, index } of residents) {
    nearPageTableInsert(table, key, index);
  }
}

export function nearTableChunkKeys(table: NearPageTable): ChunkKey[] {
  const keys: ChunkKey[] = [];
  const { centerChunk, radiusChunksXz } = table;
  for (let dz = -radiusChunksXz; dz <= radiusChunksXz; dz++) {
    for (let dx = -radiusChunksXz; dx <= radiusChunksXz; dx++) {
      const key = { x: centerChunk.x + dx, z: centerChunk.z + dz };
      if (nearPageTableLookup(table, key) >= 0) keys.push(key);
    }
  }
  return keys;
}
