import { describe, expect, it } from "vitest";
import type { WaterVisualConfig } from "./waterConfig.js";
import { DEFAULT_WATER_VISUAL } from "./water_config_defaults.js";
import { applyCanopyWaterReflectionFallback } from "./water_canopy_reflection_fallback.js";

describe("water canopy reflection fallback", () => {
  it("shifts SSR misses from sky toward terrain/vegetation under accepted canopy", () => {
    const visual = waterVisual();
    const adjusted = applyCanopyWaterReflectionFallback(visual, {
      canopyDensity: 0.7,
      canopyHeightM: 16,
      broadleafCoverage: 0.55,
      coniferCoverage: 0.25,
      competition: 0.8,
      forestEdge: 0.3,
      understoryDensity: 0.4,
      grassSuppression: 0.75,
    });

    expect(adjusted).not.toBe(visual);
    expect(adjusted.reflection.terrainFallbackStrength)
      .toBeGreaterThan(visual.reflection.terrainFallbackStrength);
    expect(adjusted.reflection.skyFallbackStrength)
      .toBeLessThan(visual.reflection.skyFallbackStrength);
    expect(adjusted.reflection.maxSteps).toBe(visual.reflection.maxSteps);
  });

  it("preserves the configured visual object before the canopy field is ready", () => {
    const visual = waterVisual();
    expect(applyCanopyWaterReflectionFallback(visual, null)).toBe(visual);
  });
});

function waterVisual(): WaterVisualConfig {
  return {
    ...DEFAULT_WATER_VISUAL,
    reflection: {
      ...DEFAULT_WATER_VISUAL.reflection,
      mode: "ssr",
      ssrEnabled: true,
      maxSteps: 12,
      stepScale: 0.5,
      edgeFadeStart: 0.8,
      edgeFadeEnd: 1,
      skyFallbackStrength: 0.8,
      terrainFallbackStrength: 0.4,
      clipmapTiers: {
        ...DEFAULT_WATER_VISUAL.reflection.clipmapTiers,
        enabled: true,
        fullQualityMaxCellSizeM: 2,
        midQualityMaxCellSizeM: 8,
        midMaxSteps: 6,
      },
    },
  };
}
