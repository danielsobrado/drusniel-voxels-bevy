import { describe, expect, it } from "vitest";
import {
  DEFAULT_FAR_SUMMARY_ATLAS_FORMAT,
  estimateFarSummaryAtlasBytes,
  packUnorm8,
  resolveFarSummaryAtlasPackingSpec,
  unpackUnorm8,
} from "../farSummaryAtlasPacking.js";

describe("far summary atlas packing", () => {
  it("defaults to balanced packing", () => {
    expect(DEFAULT_FAR_SUMMARY_ATLAS_FORMAT).toBe("balanced");
    const spec = resolveFarSummaryAtlasPackingSpec();

    expect(spec.format).toBe("balanced");
    expect(spec.heightComponents).toBe(1);
    expect(spec.storesHeightRange).toBe(false);
    expect(spec.storesNormalAtlas).toBe(false);
  });

  it("keeps debug RGBA32F as an opt-in high precision format", () => {
    const spec = resolveFarSummaryAtlasPackingSpec("debug_rgba32f");

    expect(spec.heightComponents).toBe(4);
    expect(spec.storesHeightRange).toBe(true);
    expect(spec.storesNormalAtlas).toBe(true);
  });

  it("estimates balanced atlas memory below debug RGBA32F", () => {
    const estimate = estimateFarSummaryAtlasBytes(160, 480, resolveFarSummaryAtlasPackingSpec("balanced"));

    expect(estimate.totalBytes).toBeLessThan(estimate.debugRgba32fBytes);
    expect(estimate.savingsBytes).toBeGreaterThan(0);
    expect(estimate.savingsPct).toBeGreaterThan(0.7);
  });

  it("round-trips UNORM8 coverage conservatively", () => {
    const packed = packUnorm8(0.25);
    const unpacked = unpackUnorm8(packed);

    expect(packed).toBe(64);
    expect(unpacked).toBeCloseTo(0.25, 2);
    expect(packUnorm8(-1)).toBe(0);
    expect(packUnorm8(2)).toBe(255);
  });
});
