import { describe, expect, it } from "vitest";
import {
  DEEP_OCEAN_GPU_WAVES,
  DEEP_OCEAN_SPECTRUM,
  deepOceanSpectrumWaveCount,
  deepOceanWaveVerticalBounds,
} from "./deep_ocean_waves.js";

describe("deep ocean GPU wave cache", () => {
  it("keeps the two-cascade reference spectrum cached for GPU upload", () => {
    expect(DEEP_OCEAN_SPECTRUM.gridK).toBe(16);
    expect(DEEP_OCEAN_SPECTRUM.patchCoarse).toBe(250);
    expect(DEEP_OCEAN_SPECTRUM.patchFine).toBe(37);
    expect(DEEP_OCEAN_SPECTRUM.activeGpuWaves).toBeLessThanOrEqual(64);
    expect(deepOceanSpectrumWaveCount()).toBeGreaterThan(32);
    expect(DEEP_OCEAN_GPU_WAVES).toHaveLength(deepOceanSpectrumWaveCount());
  });

  it("precomputes finite immutable wave constants", () => {
    expect(Object.isFrozen(DEEP_OCEAN_GPU_WAVES)).toBe(true);
    for (const wave of DEEP_OCEAN_GPU_WAVES) {
      expect(Number.isFinite(wave.dirX)).toBe(true);
      expect(Number.isFinite(wave.dirZ)).toBe(true);
      expect(Number.isFinite(wave.k)).toBe(true);
      expect(Number.isFinite(wave.omega)).toBe(true);
      expect(Number.isFinite(wave.amp)).toBe(true);
      expect(Number.isFinite(wave.phase)).toBe(true);
      expect(Number.isFinite(wave.choppiness)).toBe(true);
    }
    expect(deepOceanWaveVerticalBounds()).toBeGreaterThan(1);
  });
});
