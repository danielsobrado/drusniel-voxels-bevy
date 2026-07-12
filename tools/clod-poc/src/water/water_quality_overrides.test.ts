import { describe, expect, it } from "vitest";
import { DEFAULT_WATER_CONFIG } from "./water_config_defaults.js";
import { applyWaterQueryOverrides } from "./water_quality_overrides.js";

describe("water quality overrides", () => {
  it("applies low-cost water defaults for perf captures", () => {
    const config = applyWaterQueryOverrides(DEFAULT_WATER_CONFIG, new URLSearchParams({ quality: "perf" }));

    expect(config.cellsPerLevel).toBeLessThanOrEqual(64);
    expect(config.cellSizes).toEqual([3, 6, 12, 24]);
    expect(config.visual.refraction.enabled).toBe(false);
    expect(config.visual.reflection.ssrEnabled).toBe(false);
    expect(config.caustics.enabled).toBe(false);
    expect(config.hydrology.accumulation.particles).toBeLessThanOrEqual(120_000);
  });

  it("lets explicit water query flags override quality defaults", () => {
    const config = applyWaterQueryOverrides(DEFAULT_WATER_CONFIG, new URLSearchParams({
      quality: "perf",
      water: "0",
      waterCells: "32",
      waterRefraction: "1",
      waterCaustics: "1",
    }));

    expect(config.enabled).toBe(false);
    expect(config.cellsPerLevel).toBe(32);
    expect(config.visual.refraction.enabled).toBe(true);
    expect(config.caustics.enabled).toBe(true);
  });

  it("overrides unified startup hydrology via hydroUnified flag", () => {
    const off = applyWaterQueryOverrides(DEFAULT_WATER_CONFIG, new URLSearchParams({ hydroUnified: "0" }));
    expect(off.hydrology.infinite.unifiedStartup).toBe(false);

    const on = applyWaterQueryOverrides(DEFAULT_WATER_CONFIG, new URLSearchParams({ hydroUnified: "1" }));
    expect(on.hydrology.infinite.unifiedStartup).toBe(true);

    const untouched = applyWaterQueryOverrides(DEFAULT_WATER_CONFIG, new URLSearchParams());
    expect(untouched.hydrology.infinite.unifiedStartup).toBe(DEFAULT_WATER_CONFIG.hydrology.infinite.unifiedStartup);
  });
});
