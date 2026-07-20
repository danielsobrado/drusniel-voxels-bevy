import { describe, expect, it } from "vitest";
import type { WaterVisualConfig } from "./waterConfig.js";
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
    shallowColor: [0.1, 0.2, 0.3],
    deepColor: [0.01, 0.05, 0.08],
    foamColor: [0.9, 0.9, 0.9],
    alpha: 0.8,
    rippleCycle: 8,
    fresnelPower: 5,
    rippleAmp: 0.1,
    rippleSpeed: 1,
    rippleScaleA: 1,
    rippleScaleB: 2,
    rippleStrengthA: 1,
    rippleStrengthB: 1,
    rippleLoopDistance: 12,
    lakeBreeze: [1, 0],
    shoreFoamStart: 0.1,
    shoreFoamEnd: 0.4,
    maxDepthForColor: 8,
    foam: {
      noiseScale: 1,
      shoreStrength: 1,
      riverStrength: 1,
      speedStart: 0,
      speedEnd: 1,
      dropStart: 0,
      dropEnd: 1,
      shoreDistanceStart: 0,
      shoreDistanceEnd: 2,
      detailFadeStartM: 40,
      detailFadeEndM: 100,
    },
    fresnel: { base: 0.02, power: 5, normalFlatten: 0.4 },
    color: { depthScale: 1, turbidity: 0.2 },
    bodies: {} as WaterVisualConfig["bodies"],
    glacialMurkiness: {} as WaterVisualConfig["glacialMurkiness"],
    rockFlour: {} as WaterVisualConfig["rockFlour"],
    glitter: {} as WaterVisualConfig["glitter"],
    refraction: {
      enabled: true,
      strength: 0.2,
      depthValidationBias: 0.1,
      absorptionR: 0.1,
      absorptionG: 0.1,
      absorptionB: 0.1,
      turbidityStrength: 0.2,
      maxThickness: 4,
    },
    reflection: {
      mode: "ssr",
      ssrEnabled: true,
      maxSteps: 12,
      stepScale: 0.5,
      edgeFadeStart: 0.8,
      edgeFadeEnd: 1,
      skyFallbackStrength: 0.8,
      terrainFallbackStrength: 0.4,
      clipmapTiers: {
        enabled: true,
        fullQualityMaxCellSizeM: 2,
        midQualityMaxCellSizeM: 8,
        midMaxSteps: 6,
      },
    },
    depthWrite: false,
  };
}
