import { describe, expect, it } from "vitest";
import type { DressingStableId } from "../types.js";
import {
  buildDressingPersistentExclusionTable,
  dressingPersistentExclusionHash,
  dressingPersistentExclusionTableContains,
} from "./persistent_exclusion_table.js";

describe("dressing persistent exclusion table", () => {
  it("keeps an explicit empty-slot marker so zero remains a valid identity", () => {
    const zero = { lo: 0, hi: 0 };
    const table = buildDressingPersistentExclusionTable([zero]);

    expect(table.count).toBe(1);
    expect(table.capacity).toBe(2);
    expect(dressingPersistentExclusionTableContains(table, zero)).toBe(true);
    expect(dressingPersistentExclusionTableContains(table, { lo: 1, hi: 0 })).toBe(false);
  });

  it("preserves both words, including unsigned high-bit identities", () => {
    const identities = [
      { lo: 0xfedcba98, hi: 0x87654321 },
      { lo: 0x12345678, hi: 0xf1234567 },
    ];
    const table = buildDressingPersistentExclusionTable(identities);

    for (const identity of identities) {
      expect(dressingPersistentExclusionTableContains(table, identity)).toBe(true);
    }
  });

  it("deduplicates and produces order-independent packed words", () => {
    const a = { lo: 11, hi: 21 };
    const b = { lo: 31, hi: 41 };
    const forward = buildDressingPersistentExclusionTable([a, b, a]);
    const reverse = buildDressingPersistentExclusionTable([b, a]);

    expect(forward.count).toBe(2);
    expect([...forward.words]).toEqual([...reverse.words]);
  });

  it("resolves linear-probe collisions without false positives", () => {
    const capacityMask = 3;
    const bySlot = new Map<number, DressingStableId>();
    let pair: readonly [DressingStableId, DressingStableId] | null = null;
    for (let lo = 0; lo < 10_000 && !pair; lo++) {
      const identity = { lo, hi: 0x80000000 };
      const slot = dressingPersistentExclusionHash(identity) & capacityMask;
      const previous = bySlot.get(slot);
      if (previous) pair = [previous, identity];
      else bySlot.set(slot, identity);
    }
    expect(pair).not.toBeNull();

    const table = buildDressingPersistentExclusionTable(pair!);
    expect(table.capacity).toBe(4);
    expect(dressingPersistentExclusionTableContains(table, pair![0])).toBe(true);
    expect(dressingPersistentExclusionTableContains(table, pair![1])).toBe(true);
    expect(dressingPersistentExclusionTableContains(table, { lo: 0xffffffff, hi: 7 })).toBe(false);
  });
});
