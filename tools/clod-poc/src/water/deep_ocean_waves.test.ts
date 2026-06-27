import { describe, expect, it } from "vitest";
import { DEFAULT_BORDER_COAST_OCEAN_CONFIG } from "../terrain/border_coast_config.js";
import {
  DEEP_OCEAN_GPU_WAVES,
  configureDeepOceanWaves,
  deepOceanGpuWaves,
  deepOceanSpectrumWaveCount,
  deepOceanWaveVerticalBounds,
  sampleDeepOceanWave,
} from "./deep_ocean_waves.js";

describe("deep ocean GPU wave cache", () => {
  it("keeps the material wave count stable across config changes", () => {
    const base = deepOceanGpuWaves(DEFAULT_BORDER_COAST_OCEAN_CONFIG.deepOcean.wave);
    const tuned = deepOceanGpuWaves({
      ...DEFAULT_BORDER_COAST_OCEAN_CONFIG.deepOcean.wave,
      activeGpuWaves: 8,
      heightScale: 0.25,
    });

    expect(tuned.length).toBe(base.length);
    expect(deepOceanSpectrumWaveCount(tuned)).toBe(base.length);
    expect(DEEP_OCEAN_GPU_WAVES).toHaveLength(base.length);
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

  it("changes sampled water when YAML wave inputs change", () => {
    const defaults = DEFAULT_BORDER_COAST_OCEAN_CONFIG.deepOcean.wave;
    const base = sampleDeepOceanWave(128, 64, 3, deepOceanGpuWaves(defaults));
    const tuned = sampleDeepOceanWave(128, 64, 3, deepOceanGpuWaves({
      ...defaults,
      windDirectionDeg: defaults.windDirectionDeg + 90,
      heightScale: defaults.heightScale * 0.2,
      choppiness: defaults.choppiness * 0.5,
    }));

    expect(Math.abs(tuned.height - base.height)).toBeGreaterThan(0.001);
    expect(Math.abs(tuned.velocityX - base.velocityX) + Math.abs(tuned.velocityZ - base.velocityZ)).toBeGreaterThan(0.001);
  });

  it("updates the live material wave binding before material creation", () => {
    const defaults = DEFAULT_BORDER_COAST_OCEAN_CONFIG.deepOcean.wave;
    const configured = configureDeepOceanWaves({
      ...defaults,
      heightScale: defaults.heightScale * 0.1,
    });

    expect(configured.length).toBe(deepOceanGpuWaves(defaults).length);
  });
});
