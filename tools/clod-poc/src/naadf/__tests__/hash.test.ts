import { describe, expect, it } from "vitest";
import {
  createHashFallback,
  hashFallbackInsert,
  hashFallbackLookup,
  hashFallbackRemove,
} from "../hash.js";

describe("naadf hash fallback", () => {
  it("inserts and finds chunks", () => {
    const table = createHashFallback(64);
    const key = { x: 5, z: -3 };
    expect(hashFallbackInsert(table, key, 7, 1)).toBe(true);
    expect(hashFallbackLookup(table, key)).toBe(7);
  });

  it("handles collision", () => {
    const table = createHashFallback(8);
    hashFallbackInsert(table, { x: 0, z: 0 }, 1, 1);
    hashFallbackInsert(table, { x: 8, z: 0 }, 2, 1);
    expect(hashFallbackLookup(table, { x: 0, z: 0 })).toBe(1);
    expect(hashFallbackLookup(table, { x: 8, z: 0 })).toBe(2);
  });

  it("handles negative coordinates", () => {
    const table = createHashFallback(32);
    const key = { x: -12, z: -7 };
    hashFallbackInsert(table, key, 3, 1);
    expect(hashFallbackLookup(table, key)).toBe(3);
  });

  it("missing key returns not found", () => {
    const table = createHashFallback(16);
    expect(hashFallbackLookup(table, { x: 99, z: 99 })).toBe(-1);
  });

  it("slot index stays in range for extreme coordinates", () => {
    for (let x = -1024; x <= 1024; x += 17) {
      for (let z = -1024; z <= 1024; z += 23) {
        const table = createHashFallback(64);
        const key = { x, z };
        expect(hashFallbackInsert(table, key, 7, 1)).toBe(true);
        expect(hashFallbackLookup(table, key)).toBe(7);
      }
    }
  });

  it("reports table full when capacity is exceeded", () => {
    const table = createHashFallback(4);
    expect(hashFallbackInsert(table, { x: 0, z: 0 }, 0, 1)).toBe(true);
    expect(hashFallbackInsert(table, { x: 1, z: 0 }, 1, 1)).toBe(true);
    expect(hashFallbackInsert(table, { x: 2, z: 0 }, 2, 1)).toBe(true);
    expect(hashFallbackInsert(table, { x: 3, z: 0 }, 3, 1)).toBe(true);
    expect(hashFallbackInsert(table, { x: 4, z: 0 }, 4, 1)).toBe(false);
  });

  it("eviction removes the correct key", () => {
    const table = createHashFallback(16);
    const key = { x: 1, z: 2 };
    hashFallbackInsert(table, key, 4, 1);
    expect(hashFallbackRemove(table, key)).toBe(true);
    expect(hashFallbackLookup(table, key)).toBe(-1);
  });
});
