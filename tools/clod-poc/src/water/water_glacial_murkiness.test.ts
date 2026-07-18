import { describe, expect, it } from "vitest";
import { DEFAULT_WATER_VISUAL } from "./water_config_defaults.js";
import { parseWaterConfig } from "./water_config_parsing.js";
import type { WaterGlacialMurkinessConfig } from "./water_config_types.js";
import {
  effectiveWaterGlacialMurkiness,
  resolveGlacialWaterBodyPresets,
  resolveGlacialWaterVisual,
} from "./water_glacial_murkiness.js";

const CONFIG: WaterGlacialMurkinessConfig = {
  enabled: true,
  lakeStrength: 1,
  riverStrength: 0.5,
  absorptionMultiplier: [2, 1.5, 1],
  turbidityAdd: 0.4,
  reflectionDampingMin: 0.5,
};

const ENABLED_STATE = { enabled: true, glacialMurkiness: 0.5 } as const;

describe("glacial water murkiness", () => {
  it("preserves exact visual identity while the feature is disabled", () => {
    const disabled = { ...CONFIG, enabled: false };

    expect(effectiveWaterGlacialMurkiness(disabled, ENABLED_STATE)).toBe(0);
    expect(resolveGlacialWaterBodyPresets(DEFAULT_WATER_VISUAL.bodies, disabled, ENABLED_STATE))
      .toBe(DEFAULT_WATER_VISUAL.bodies);
    expect(resolveGlacialWaterVisual(DEFAULT_WATER_VISUAL, ENABLED_STATE)).toBe(DEFAULT_WATER_VISUAL);
  });

  it("preserves exact body identity when the shared visual state is disabled", () => {
    const resolved = resolveGlacialWaterBodyPresets(
      DEFAULT_WATER_VISUAL.bodies,
      CONFIG,
      { enabled: false, glacialMurkiness: 1 },
    );

    expect(resolved).toBe(DEFAULT_WATER_VISUAL.bodies);
  });

  it("modifies only lake and river optical presets without mutating the base", () => {
    const base = DEFAULT_WATER_VISUAL.bodies;
    const lakeAbsorptionBefore = [...base.lake.absorption];
    const riverAbsorptionBefore = [...base.river.absorption];
    const resolved = resolveGlacialWaterBodyPresets(base, CONFIG, ENABLED_STATE);

    expect(resolved).not.toBe(base);
    expect(resolved.ocean).toBe(base.ocean);
    expect(resolved.pond).toBe(base.pond);
    expect(resolved.marsh).toBe(base.marsh);
    expect(resolved.lake).not.toBe(base.lake);
    expect(resolved.river).not.toBe(base.river);

    expect(resolved.lake.absorption[0]).toBeCloseTo(base.lake.absorption[0] * 1.5, 6);
    expect(resolved.lake.absorption[1]).toBeCloseTo(base.lake.absorption[1] * 1.25, 6);
    expect(resolved.lake.absorption[2]).toBeCloseTo(base.lake.absorption[2], 6);
    expect(resolved.lake.turbidity).toBeCloseTo(base.lake.turbidity + 0.2, 6);
    expect(resolved.lake.reflectionDamping).toBeCloseTo(0.75, 6);

    expect(resolved.river.absorption[0]).toBeCloseTo(base.river.absorption[0] * 1.25, 6);
    expect(resolved.river.turbidity).toBeCloseTo(base.river.turbidity + 0.1, 6);
    expect(resolved.river.reflectionDamping).toBeCloseTo(0.875, 6);

    expect(base.lake.absorption).toEqual(lakeAbsorptionBefore);
    expect(base.river.absorption).toEqual(riverAbsorptionBefore);
  });

  it("clamps invalid tuning and never turns murkiness into clearer water", () => {
    const resolved = resolveGlacialWaterBodyPresets(
      DEFAULT_WATER_VISUAL.bodies,
      {
        enabled: true,
        lakeStrength: 4,
        riverStrength: -1,
        absorptionMultiplier: [0.2, Number.NaN, 2],
        turbidityAdd: 4,
        reflectionDampingMin: -3,
      },
      { enabled: true, glacialMurkiness: 2 },
    );

    expect(resolved.lake.absorption[0]).toBe(DEFAULT_WATER_VISUAL.bodies.lake.absorption[0]);
    expect(resolved.lake.absorption[1]).toBe(DEFAULT_WATER_VISUAL.bodies.lake.absorption[1]);
    expect(resolved.lake.absorption[2]).toBe(DEFAULT_WATER_VISUAL.bodies.lake.absorption[2] * 2);
    expect(resolved.lake.turbidity).toBe(1);
    expect(resolved.lake.reflectionDamping).toBe(0);
    expect(resolved.river).toBe(DEFAULT_WATER_VISUAL.bodies.river);
  });

  it("parses YAML tuning without enabling it implicitly", () => {
    const config = parseWaterConfig([
      "water:",
      "  visual:",
      "    glacial_murkiness:",
      "      enabled: true",
      "      lake_strength: 0.9",
      "      river_strength: 0.6",
      "      absorption_multiplier: [1.7, 1.4, 1.2]",
      "      turbidity_add: 0.3",
      "      reflection_damping_min: 0.65",
    ].join("\n"), () => {});

    expect(config.visual.glacialMurkiness).toEqual({
      enabled: true,
      lakeStrength: 0.9,
      riverStrength: 0.6,
      absorptionMultiplier: [1.7, 1.4, 1.2],
      turbidityAdd: 0.3,
      reflectionDampingMin: 0.65,
    });
    expect(DEFAULT_WATER_VISUAL.glacialMurkiness.enabled).toBe(false);
  });
});
