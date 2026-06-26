import { describe, expect, it } from "vitest";
import {
  DEEP_OCEAN_SPECTRUM,
  deepOceanSpectrumWaveCount,
  deepOceanWaveVerticalBounds,
  sampleDeepOceanNormal,
  sampleDeepOceanWave,
} from "./deep_ocean_waves.js";

describe("deep ocean spectral waves", () => {
  it("keeps the two-cascade reference spectrum active", () => {
    expect(DEEP_OCEAN_SPECTRUM.gridK).toBe(16);
    expect(DEEP_OCEAN_SPECTRUM.patchCoarse).toBe(250);
    expect(DEEP_OCEAN_SPECTRUM.patchFine).toBe(37);
    expect(deepOceanSpectrumWaveCount()).toBeGreaterThan(32);
  });

  it("samples animated height, chop, compression, and normal", () => {
    const a = sampleDeepOceanWave(12, 24, 0);
    const b = sampleDeepOceanWave(12, 24, 2);
    expect(Math.abs(a.dy - b.dy)).toBeGreaterThan(0.001);
    expect(Math.hypot(b.dx, b.dz)).toBeGreaterThan(0.001);
    expect(b.compression).toBeGreaterThanOrEqual(0);
    expect(b.compression).toBeLessThanOrEqual(1);

    const n = sampleDeepOceanNormal(12, 24, 2);
    expect(Math.abs(Math.hypot(n[0], n[1], n[2]) - 1)).toBeLessThan(0.001);
    expect(deepOceanWaveVerticalBounds()).toBeGreaterThan(1);
  });
});
