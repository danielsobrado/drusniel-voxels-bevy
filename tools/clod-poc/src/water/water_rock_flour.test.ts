import { describe, expect, it } from "vitest";
import { cloneWaterConfig } from "./water_config_clone.js";
import { DEFAULT_WATER_CONFIG, DEFAULT_WATER_VISUAL } from "./water_config_defaults.js";
import { parseWaterConfig } from "./water_config_parsing.js";
import type { WaterRockFlourConfig } from "./water_config_types.js";
import {
  effectiveWaterRockFlour,
  resolveRockFlourWaterBodyPresets,
  resolveRockFlourWaterVisual,
  resolveWaterRockFlourEnabled,
} from "./water_rock_flour.js";

const CONFIG: WaterRockFlourConfig = {
  enabled: true,
  lakeStrength: 1,
  riverStrength: 0.5,
  lakeColor: [0.2, 0.4, 0.6],
  riverColor: [0.3, 0.5, 0.7],
  shallowBlend: 0.8,
  deepBlend: 0.4,
};

const ENABLED_STATE = { enabled: true, glacialMurkiness: 0.5 } as const;

describe("rock flour water colour", () => {
  it("preserves exact visual identity while disabled", () => {
    const disabled = { ...CONFIG, enabled: false };

    expect(effectiveWaterRockFlour(disabled, ENABLED_STATE)).toBe(0);
    expect(resolveRockFlourWaterBodyPresets(DEFAULT_WATER_VISUAL.bodies, disabled, ENABLED_STATE))
      .toBe(DEFAULT_WATER_VISUAL.bodies);
    expect(resolveRockFlourWaterVisual(DEFAULT_WATER_VISUAL, ENABLED_STATE))
      .toBe(DEFAULT_WATER_VISUAL);
  });

  it("preserves identity when the shared biome state is disabled", () => {
    expect(resolveRockFlourWaterBodyPresets(
      DEFAULT_WATER_VISUAL.bodies,
      CONFIG,
      { enabled: false, glacialMurkiness: 1 },
    )).toBe(DEFAULT_WATER_VISUAL.bodies);
  });

  it("tints lake and river colours independently while preserving optical coefficients", () => {
    const base = DEFAULT_WATER_VISUAL.bodies;
    const resolved = resolveRockFlourWaterBodyPresets(base, CONFIG, ENABLED_STATE);

    expect(resolved.ocean).toBe(base.ocean);
    expect(resolved.pond).toBe(base.pond);
    expect(resolved.marsh).toBe(base.marsh);
    expect(resolved.lake.absorption).toBe(base.lake.absorption);
    expect(resolved.river.absorption).toBe(base.river.absorption);
    expect(resolved.lake.turbidity).toBe(base.lake.turbidity);
    expect(resolved.lake.reflectionDamping).toBe(base.lake.reflectionDamping);

    expect(resolved.lake.shallowColor[0]).toBeCloseTo(0.08, 6);
    expect(resolved.lake.shallowColor[1]).toBeCloseTo(0.352, 6);
    expect(resolved.lake.shallowColor[2]).toBeCloseTo(0.57, 6);
    expect(resolved.lake.deepColor[0]).toBeCloseTo(0.04, 6);
    expect(resolved.lake.deepColor[1]).toBeCloseTo(0.1, 6);
    expect(resolved.lake.deepColor[2]).toBeCloseTo(0.216, 6);

    expect(resolved.river.shallowColor[0]).toBeCloseTo(0.06, 6);
    expect(resolved.river.shallowColor[1]).toBeCloseTo(0.356, 6);
    expect(resolved.river.shallowColor[2]).toBeCloseTo(0.58, 6);
  });

  it("clamps invalid colours, strengths, and blend amounts", () => {
    const base = DEFAULT_WATER_VISUAL.bodies;
    const resolved = resolveRockFlourWaterBodyPresets(base, {
      enabled: true,
      lakeStrength: 5,
      riverStrength: -1,
      lakeColor: [-2, Number.NaN, 4],
      riverColor: [1, 1, 1],
      shallowBlend: 3,
      deepBlend: -2,
    }, { enabled: true, glacialMurkiness: 2 });

    expect(resolved.lake.shallowColor).toEqual([0, base.lake.shallowColor[1], 1]);
    expect(resolved.lake.deepColor).toEqual(base.lake.deepColor);
    expect(resolved.river).toBe(base.river);
  });

  it("supports an explicit query kill switch without changing YAML ownership", () => {
    expect(resolveWaterRockFlourEnabled(false, new URLSearchParams())).toBe(false);
    expect(resolveWaterRockFlourEnabled(false, new URLSearchParams({ waterRockFlour: "1" }))).toBe(true);
    expect(resolveWaterRockFlourEnabled(true, new URLSearchParams({ rockFlourWater: "off" }))).toBe(false);
    expect(resolveWaterRockFlourEnabled(false, new URLSearchParams({ glacialRockFlour: "yes" }))).toBe(true);
  });

  it("parses YAML tuning and clones all colour tuples deeply", () => {
    const parsed = parseWaterConfig([
      "water:",
      "  visual:",
      "    rock_flour:",
      "      enabled: true",
      "      lake_strength: 0.9",
      "      river_strength: 0.7",
      "      lake_color: [0.1, 0.4, 0.3]",
      "      river_color: [0.2, 0.5, 0.4]",
      "      shallow_blend: 0.6",
      "      deep_blend: 0.25",
    ].join("\n"), () => {});

    expect(parsed.visual.rockFlour).toEqual({
      enabled: true,
      lakeStrength: 0.9,
      riverStrength: 0.7,
      lakeColor: [0.1, 0.4, 0.3],
      riverColor: [0.2, 0.5, 0.4],
      shallowBlend: 0.6,
      deepBlend: 0.25,
    });

    const cloned = cloneWaterConfig(parsed);
    expect(cloned.visual.rockFlour).not.toBe(parsed.visual.rockFlour);
    expect(cloned.visual.rockFlour.lakeColor).not.toBe(parsed.visual.rockFlour.lakeColor);
    expect(cloned.visual.rockFlour.riverColor).not.toBe(parsed.visual.rockFlour.riverColor);
    expect(DEFAULT_WATER_CONFIG.visual.rockFlour.enabled).toBe(false);
  });
});
