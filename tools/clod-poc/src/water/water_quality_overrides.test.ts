import { describe, expect, it } from "vitest";
import { DEFAULT_WATER_CONFIG } from "./water_config_defaults.js";
import { applyWaterQueryOverrides, resolveWaterQualityTier } from "./water_quality_overrides.js";

describe("water quality overrides", () => {
  it("selects the high material by default and preserves low-tier aliases", () => {
    expect(resolveWaterQualityTier(new URLSearchParams())).toBe("high");
    expect(resolveWaterQualityTier(new URLSearchParams({ waterQuality: "low" }))).toBe("low");
    expect(resolveWaterQualityTier(new URLSearchParams({ waterHq: "0" }))).toBe("low");
    expect(resolveWaterQualityTier(new URLSearchParams({ quality: "perf" }))).toBe("low");
    expect(resolveWaterQualityTier(new URLSearchParams({ waterPerf: "1" }))).toBe("low");
    expect(resolveWaterQualityTier(new URLSearchParams({ quality: "perf", waterQuality: "high" }))).toBe("high");
  });

  it("enables analytic caustics for high water unless explicitly disabled", () => {
    const high = applyWaterQueryOverrides(DEFAULT_WATER_CONFIG, new URLSearchParams());
    expect(high.caustics.enabled).toBe(true);

    const disabled = applyWaterQueryOverrides(DEFAULT_WATER_CONFIG, new URLSearchParams({ waterCaustics: "0" }));
    expect(disabled.caustics.enabled).toBe(false);
  });

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

  it("supports a bounded ripple-amplitude diagnostic override", () => {
    const flat = applyWaterQueryOverrides(
      DEFAULT_WATER_CONFIG,
      new URLSearchParams({ waterRippleAmp: "0" }),
    );
    const bounded = applyWaterQueryOverrides(
      DEFAULT_WATER_CONFIG,
      new URLSearchParams({ waterRippleAmp: "99" }),
    );

    expect(flat.visual.rippleAmp).toBe(0);
    expect(bounded.visual.rippleAmp).toBe(4);
  });

  it("supports a bounded numeric water debug-mode override", () => {
    const debug = applyWaterQueryOverrides(
      DEFAULT_WATER_CONFIG,
      new URLSearchParams({ waterMaterialDebug: "12" }),
    );
    expect(debug.debug.mode).toBe(12);
  });

  it("keeps glacial murkiness disabled unless explicitly requested", () => {
    const untouched = applyWaterQueryOverrides(DEFAULT_WATER_CONFIG, new URLSearchParams());
    expect(untouched.visual.glacialMurkiness.enabled).toBe(false);

    const enabled = applyWaterQueryOverrides(
      DEFAULT_WATER_CONFIG,
      new URLSearchParams({ waterGlacialMurkiness: "1" }),
    );
    expect(enabled.visual.glacialMurkiness.enabled).toBe(true);

    const disabled = applyWaterQueryOverrides(
      { ...DEFAULT_WATER_CONFIG, visual: { ...DEFAULT_WATER_CONFIG.visual, glacialMurkiness: {
        ...DEFAULT_WATER_CONFIG.visual.glacialMurkiness,
        enabled: true,
      } } },
      new URLSearchParams({ glacialWater: "0" }),
    );
    expect(disabled.visual.glacialMurkiness.enabled).toBe(false);
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
