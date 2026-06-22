import { describe, expect, it } from "vitest";
import { hashCombine, hashString, Rng, vegRng } from "./veg_rng.js";

describe("veg Rng", () => {
  it("is deterministic for a given seed", () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const seqA = Array.from({ length: 16 }, () => a.float());
    const seqB = Array.from({ length: 16 }, () => b.float());
    expect(seqA).toEqual(seqB);
  });

  it("produces floats in [0,1) and ints in [0,n)", () => {
    const rng = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const f = rng.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = rng.int(5);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(5);
    }
  });

  it("decorrelates forked streams (no sequence coupling)", () => {
    const seqFor = (label: string): number[] => {
      const root = new Rng(999);
      const child = root.fork(label);
      return Array.from({ length: 8 }, () => child.float());
    };
    const fa = seqFor("a");
    const fb = seqFor("b");
    expect(fa).not.toEqual(fb);
    // same label ⇒ identical child stream
    expect(seqFor("a")).toEqual(fa);
  });

  it("vegRng is order-independent per stream name", () => {
    const x = Array.from({ length: 8 }, () => vegRng(42, "trees").float());
    const y = Array.from({ length: 8 }, () => vegRng(42, "trees").float());
    expect(x).toEqual(y);
    expect(Array.from({ length: 8 }, () => vegRng(42, "grass").float())).not.toEqual(x);
  });

  it("hash helpers are stable", () => {
    expect(hashString("trees")).toBe(hashString("trees"));
    expect(hashString("trees")).not.toBe(hashString("grass"));
    expect(hashCombine(1, 2)).toBe(hashCombine(1, 2));
    expect(hashCombine(1, 2)).not.toBe(hashCombine(2, 1));
  });
});
