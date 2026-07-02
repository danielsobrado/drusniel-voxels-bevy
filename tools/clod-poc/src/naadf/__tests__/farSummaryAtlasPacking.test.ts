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
    expect(spec.heightFormat).toBe("r32f");
    expect(spec.heightComponents).toBe(1);
    expect(spec.storesHeightRange).toBe(false);
    expect(spec.storesNormalAtlas).toBe(false);
  });

  it("keeps debug RGBA32F as an opt-in high precision format", () => {
    const spec = resolveFarSummaryAtlasPackingSpec("debug_rgba32f");

    expect(spec.heightFormat).toBe("r32f");
    expect(spec.heightComponents).toBe(4);
    expect(spec.storesHeightRange).toBe(true);
    expect(spec.storesNormalAtlas).toBe(true);
  });

  it("makes packed_low_bandwidth more aggressive than balanced", () => {
    const balanced = resolveFarSummaryAtlasPackingSpec("balanced");
    const low = resolveFarSummaryAtlasPackingSpec("packed_low_bandwidth");

    expect(low.heightFormat).toBe("r16f");
    expect(low.heightBytesPerPixel).toBeLessThan(balanced.heightBytesPerPixel);
    expect(low.storesNormalAtlas).toBe(false);
  });

  it("estimates balanced atlas memory below debug RGBA32F", () => {
    const estimate = estimateFarSummaryAtlasBytes(160, 480, resolveFarSummaryAtlasPackingSpec("balanced"));

    expect(estimate.totalBytes).toBeLessThan(estimate.debugRgba32fBytes);
    expect(estimate.savingsBytes).toBeGreaterThan(0);
    expect(estimate.savingsPct).toBeGreaterThan(0.7);
  });

  it("estimates low bandwidth atlas memory below balanced", () => {
    const balanced = estimateFarSummaryAtlasBytes(160, 480, resolveFarSummaryAtlasPackingSpec("balanced"));
    const low = estimateFarSummaryAtlasBytes(160, 480, resolveFarSummaryAtlasPackingSpec("packed_low_bandwidth"));

    expect(low.totalBytes).toBeLessThan(balanced.totalBytes);
    expect(low.savingsPct).toBeGreaterThan(balanced.savingsPct);
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
