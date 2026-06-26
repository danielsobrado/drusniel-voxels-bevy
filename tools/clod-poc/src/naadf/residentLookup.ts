import type { ChunkKey, ResidentChunkEntry } from "./types.js";
import {
  nearPageTableInsert,
  isChunkInNearTable,
  type NearPageTable,
} from "./nearPageTable.js";
import {
  hashFallbackClear,
  hashFallbackInsert,
  hashFallbackLookup,
  type HashFallback,
} from "./hash.js";
import type { NaadfMetricsCollector } from "./metrics.js";

export function isChunkQueryable(entry: ResidentChunkEntry): boolean {
  return entry.brick !== null
    && (entry.state === "ready" || entry.state === "stale" || entry.state === "building");
}

export function syncResidentLookupTables(
  nearTable: NearPageTable,
  hashTable: HashFallback,
  residents: readonly ResidentChunkEntry[],
  metrics?: NaadfMetricsCollector,
): void {
  nearTable.slots.fill(-1);
  hashFallbackClear(hashTable);

  for (let index = 0; index < residents.length; index++) {
    const entry = residents[index]!;
    if (!isChunkQueryable(entry)) continue;
    if (isChunkInNearTable(nearTable, entry.key)) {
      nearPageTableInsert(nearTable, entry.key, index);
    } else if (!hashFallbackInsert(hashTable, entry.key, index, nearTable.epoch)) {
      if (metrics) metrics.hashInsertFailures++;
    }
  }
}

export function lookupValidatedChunkIndex(
  nearTable: NearPageTable,
  hashTable: HashFallback,
  residents: readonly ResidentChunkEntry[],
  key: ChunkKey,
): { index: number; source: "near_table" | "hash_fallback" | "missing" } {
  const tryIndex = (index: number): number => {
    if (index < 0 || index >= residents.length) return -1;
    const entry = residents[index];
    if (!entry || !isChunkQueryable(entry)) return -1;
    if (entry.key.x !== key.x || entry.key.z !== key.z) return -1;
    return index;
  };

  const diameter = nearTable.radiusChunksXz * 2 + 1;
  const dx = key.x - nearTable.centerChunk.x;
  const dz = key.z - nearTable.centerChunk.z;
  if (Math.abs(dx) <= nearTable.radiusChunksXz && Math.abs(dz) <= nearTable.radiusChunksXz) {
    const localX = dx + nearTable.radiusChunksXz;
    const localZ = dz + nearTable.radiusChunksXz;
    const slotIdx = localZ * diameter + localX;
    const nt = tryIndex(nearTable.slots[slotIdx]!);
    if (nt >= 0) return { index: nt, source: "near_table" };
  }

  const hf = tryIndex(hashFallbackLookup(hashTable, key));
  if (hf >= 0) return { index: hf, source: "hash_fallback" };

  return { index: -1, source: "missing" };
}
