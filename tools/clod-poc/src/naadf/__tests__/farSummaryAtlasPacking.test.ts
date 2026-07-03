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
    expect(spec.coverageComponents).toBe(2);
    expect(spec.coverageBytesPerPixel).toBe(2);
    expect(spec.storesHeightRange).toBe(false);
    expect(spec.storesNormalAtlas).toBe(false);
  });

  it("keeps debug packing as an opt-in high precision format", () => {
    const spec = resolveFarSummaryAtlasPackingSpec("debug_rgba32f");

    expect(spec.heightFormat).toBe("r32f");
    expect(spec.heightComponents).toBe(4);
    expect(spec.coverageComponents).toBe(4);
    expect(spec.coverageBytesPerPixel).toBe(16);
    expect(spec.storesHeightRange).toBe(true);
    expect(spec.storesNormalAtlas).toBe(true);
  });

  it("makes packed more aggressive than balanced", () => {
    const balanced = resolveFarSummaryAtlasPackingSpec("balanced");
    const packed = resolveFarSummaryAtlasPackingSpec("packed");

    expect(packed.heightFormat).toBe("r16f");
    expect(packed.heightBytesPerPixel).toBeLessThan(balanced.heightBytesPerPixel);
    expect(packed.coverageComponents).toBe(2);
    expect(packed.coverageBytesPerPixel).toBe(2);
    expect(packed.storesNormalAtlas).toBe(false);
  });

  it("keeps packed_low_bandwidth as a backward-compatible alias", () => {
    const packed = resolveFarSummaryAtlasPackingSpec("packed");
    const legacy = resolveFarSummaryAtlasPackingSpec("packed_low_bandwidth");

    expect(legacy.heightFormat).toBe(packed.heightFormat);
    expect(legacy.heightComponents).toBe(packed.heightComponents);
    expect(legacy.coverageComponents).toBe(packed.coverageComponents);
    expect(legacy.heightBytesPerPixel).toBe(packed.heightBytesPerPixel);
    expect(legacy.materialBytesPerPixel).toBe(packed.materialBytesPerPixel);
    expect(legacy.coverageBytesPerPixel).toBe(packed.coverageBytesPerPixel);
    expect(legacy.storesNormalAtlas).toBe(packed.storesNormalAtlas);
  });

  it("estimates balanced atlas memory below debug", () => {
    const estimate = estimateFarSummaryAtlasBytes(160, 480, resolveFarSummaryAtlasPackingSpec("balanced"));

    expect(estimate.totalBytes).toBeLessThan(estimate.debugRgba32fBytes);
    expect(estimate.savingsBytes).toBeGreaterThan(0);
    expect(estimate.savingsPct).toBeGreaterThan(0.7);
  });

  it("estimates packed atlas memory below balanced", () => {
    const balanced = estimateFarSummaryAtlasBytes(160, 480, resolveFarSummaryAtlasPackingSpec("balanced"));
    const packed = estimateFarSummaryAtlasBytes(160, 480, resolveFarSummaryAtlasPackingSpec("packed"));

    expect(packed.totalBytes).toBeLessThan(balanced.totalBytes);
    expect(packed.savingsPct).toBeGreaterThan(balanced.savingsPct);
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
