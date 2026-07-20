import type { DressingStableId } from "../types.js";

const WORDS_PER_ENTRY = 4;
const MINIMUM_CAPACITY = 2;

export interface DressingPersistentExclusionTable {
  readonly words: Uint32Array;
  readonly count: number;
  readonly capacity: number;
  readonly capacityMask: number;
}

export function buildDressingPersistentExclusionTable(
  identities: readonly DressingStableId[],
): DressingPersistentExclusionTable {
  const unique = deduplicateAndSort(identities);
  const capacity = nextPowerOfTwo(Math.max(MINIMUM_CAPACITY, unique.length * 2));
  const capacityMask = capacity - 1;
  const words = new Uint32Array(capacity * WORDS_PER_ENTRY);

  for (const identity of unique) {
    let slot = dressingPersistentExclusionHash(identity) & capacityMask;
    for (let probe = 0; probe < capacity; probe++) {
      const base = slot * WORDS_PER_ENTRY;
      if (words[base + 2] === 0) {
        words[base] = identity.lo >>> 0;
        words[base + 1] = identity.hi >>> 0;
        words[base + 2] = 1;
        break;
      }
      slot = (slot + 1) & capacityMask;
      if (probe === capacity - 1) throw new Error("dressing persistent exclusion table is full");
    }
  }

  return { words, count: unique.length, capacity, capacityMask };
}

export function dressingPersistentExclusionTableContains(
  table: DressingPersistentExclusionTable,
  identity: DressingStableId,
): boolean {
  if (table.count === 0) return false;
  let slot = dressingPersistentExclusionHash(identity) & table.capacityMask;
  for (let probe = 0; probe < table.capacity; probe++) {
    const base = slot * WORDS_PER_ENTRY;
    if (table.words[base + 2] === 0) return false;
    if (
      table.words[base] === (identity.lo >>> 0)
      && table.words[base + 1] === (identity.hi >>> 0)
    ) return true;
    slot = (slot + 1) & table.capacityMask;
  }
  return false;
}

export function dressingPersistentExclusionHash(identity: DressingStableId): number {
  const rotatedHi = rotateLeft32(identity.hi >>> 0, 16);
  return mix32(((identity.lo >>> 0) ^ rotatedHi ^ 0x9e3779b9) >>> 0);
}

function deduplicateAndSort(identities: readonly DressingStableId[]): DressingStableId[] {
  const unique = new Map<string, DressingStableId>();
  for (const identity of identities) {
    const lo = identity.lo >>> 0;
    const hi = identity.hi >>> 0;
    unique.set(`${hi}:${lo}`, { lo, hi });
  }
  return [...unique.values()].sort((a, b) => (a.hi - b.hi) || (a.lo - b.lo));
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(MINIMUM_CAPACITY, value)));
}

function rotateLeft32(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function mix32(value: number): number {
  let mixed = value >>> 0;
  mixed = (mixed ^ (mixed >>> 16)) >>> 0;
  mixed = Math.imul(mixed, 0x7feb352d) >>> 0;
  mixed = (mixed ^ (mixed >>> 15)) >>> 0;
  mixed = Math.imul(mixed, 0x846ca68b) >>> 0;
  return (mixed ^ (mixed >>> 16)) >>> 0;
}
