import type { ChunkKey } from "./types.js";
import { HASH_EMPTY, HASH_TOMBSTONE } from "./constants.js";
import { chunkKeyEquals } from "./keys.js";

function hashChunkKey(x: number, z: number, capacity: number): number {
  let h = Math.imul(x | 0, 73856093) ^ Math.imul(z | 0, 19349663);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) % capacity;
}

export type HashFallback = {
  capacity: number;
  keysX: Int32Array;
  keysZ: Int32Array;
  chunkIndices: Int32Array;
  epochs: Uint32Array;
};

export function createHashFallback(capacity: number): HashFallback {
  const cap = Math.max(4, capacity);
  return {
    capacity: cap,
    keysX: new Int32Array(cap).fill(HASH_EMPTY),
    keysZ: new Int32Array(cap).fill(HASH_EMPTY),
    chunkIndices: new Int32Array(cap).fill(-1),
    epochs: new Uint32Array(cap),
  };
}

export function hashFallbackInsert(
  table: HashFallback,
  key: ChunkKey,
  chunkIndex: number,
  epoch: number,
): boolean {
  const { capacity, keysX, keysZ, chunkIndices, epochs } = table;
  let slot = hashChunkKey(key.x, key.z, capacity);
  for (let probe = 0; probe < capacity; probe++) {
    const sx = keysX[slot]!;
    const sz = keysZ[slot]!;
    if (sx === HASH_EMPTY || chunkKeyEquals({ x: sx, z: sz }, key)) {
      keysX[slot] = key.x;
      keysZ[slot] = key.z;
      chunkIndices[slot] = chunkIndex;
      epochs[slot] = epoch;
      return true;
    }
    slot = (slot + 1) % capacity;
  }
  return false;
}

export function hashFallbackLookup(
  table: HashFallback,
  key: ChunkKey,
): number {
  const { capacity, keysX, keysZ, chunkIndices } = table;
  let slot = hashChunkKey(key.x, key.z, capacity);
  for (let probe = 0; probe < capacity; probe++) {
    const sx = keysX[slot]!;
    if (sx === HASH_EMPTY) return -1;
    const sz = keysZ[slot]!;
    if (chunkKeyEquals({ x: sx, z: sz }, key)) {
      return chunkIndices[slot]!;
    }
    slot = (slot + 1) % capacity;
  }
  return -1;
}

export function hashFallbackInsertOrReplace(
  table: HashFallback,
  key: ChunkKey,
  chunkIndex: number,
  epoch: number,
): boolean {
  const { capacity, keysX, keysZ, chunkIndices, epochs } = table;
  let slot = hashChunkKey(key.x, key.z, capacity);
  for (let probe = 0; probe < capacity; probe++) {
    const sx = keysX[slot]!;
    if (sx === HASH_EMPTY || sx === HASH_TOMBSTONE || chunkKeyEquals({ x: sx, z: keysZ[slot]! }, key)) {
      keysX[slot] = key.x;
      keysZ[slot] = key.z;
      chunkIndices[slot] = chunkIndex;
      epochs[slot] = epoch;
      return true;
    }
    slot = (slot + 1) % capacity;
  }
  return false;
}

export function hashFallbackRemove(
  table: HashFallback,
  key: ChunkKey,
): boolean {
  const { capacity, keysX, keysZ, chunkIndices, epochs } = table;
  let slot = hashChunkKey(key.x, key.z, capacity);
  for (let probe = 0; probe < capacity; probe++) {
    const sx = keysX[slot]!;
    if (sx === HASH_EMPTY) return false;
    const sz = keysZ[slot]!;
    if (chunkKeyEquals({ x: sx, z: sz }, key)) {
      keysX[slot] = HASH_TOMBSTONE;
      keysZ[slot] = HASH_TOMBSTONE;
      chunkIndices[slot] = -1;
      epochs[slot] = 0;
      return true;
    }
    slot = (slot + 1) % capacity;
  }
  return false;
}

export function hashFallbackClear(table: HashFallback): void {
  table.keysX.fill(HASH_EMPTY);
  table.keysZ.fill(HASH_EMPTY);
  table.chunkIndices.fill(-1);
  table.epochs.fill(0);
}

export function hashFallbackRebuild(
  table: HashFallback,
  entries: ReadonlyArray<{ key: ChunkKey; chunkIndex: number; epoch: number }>,
): void {
  hashFallbackClear(table);
  for (const e of entries) {
    hashFallbackInsertOrReplace(table, e.key, e.chunkIndex, e.epoch);
  }
}

export function hashFallbackOccupancy(table: HashFallback): number {
  let count = 0;
  for (let i = 0; i < table.capacity; i++) {
    const k = table.keysX[i]!;
    if (k !== HASH_EMPTY && k !== HASH_TOMBSTONE) count++;
  }
  return count;
}
