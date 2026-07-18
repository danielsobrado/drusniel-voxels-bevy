import { describe, expect, it } from "vitest";
import {
  STONE_META_UNDERWATER_FLAG,
  STONE_META_VARIANT_SCALE,
  packStoneInstanceMeta,
  unpackStoneInstanceMeta,
} from "./stone_instance_meta.js";

describe("stone instance metadata", () => {
  it("round-trips dry and underwater instances", () => {
    const dry = unpackStoneInstanceMeta(packStoneInstanceMeta({ variant: 3, sinkDepth: 0.42, underwater: false }));
    expect(dry.variant).toBe(3);
    expect(dry.sinkDepth).toBeCloseTo(0.42);
    expect(dry.underwater).toBe(false);

    const wet = unpackStoneInstanceMeta(packStoneInstanceMeta({ variant: 1, sinkDepth: 0.27, underwater: true }));
    expect(wet.variant).toBe(1);
    expect(wet.sinkDepth).toBeCloseTo(0.27);
    expect(wet.underwater).toBe(true);
  });

  it("keeps the flag inside each variant lane", () => {
    const packed = packStoneInstanceMeta({ variant: 2, sinkDepth: 0.5, underwater: true });
    expect(packed).toBeGreaterThanOrEqual(2 * STONE_META_VARIANT_SCALE + STONE_META_UNDERWATER_FLAG);
    expect(packed).toBeLessThan(3 * STONE_META_VARIANT_SCALE);
  });

  it("sanitizes invalid and oversized values", () => {
    expect(unpackStoneInstanceMeta(packStoneInstanceMeta({ variant: -2, sinkDepth: Number.NaN, underwater: false })))
      .toEqual({ variant: 0, sinkDepth: 0, underwater: false });

    const clamped = unpackStoneInstanceMeta(packStoneInstanceMeta({
      variant: 0,
      sinkDepth: STONE_META_VARIANT_SCALE,
      underwater: false,
    }));
    expect(clamped.sinkDepth).toBeLessThan(STONE_META_UNDERWATER_FLAG);
  });
});
