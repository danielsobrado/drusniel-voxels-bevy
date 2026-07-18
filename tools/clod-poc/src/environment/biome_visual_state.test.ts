import { describe, expect, it } from "vitest";
import { evaluateBiomeVisualState } from "./biome_visual_state.js";
import type { BiomeVisualStateSettings } from "./biome_visual_state_config.js";

const SETTINGS: BiomeVisualStateSettings = {
  enabled: true,
  seasonKeyframes: [
    {
      at: 0.1,
      green: 0.2,
      autumn: 0,
      bloom: 0.1,
      snowlineM: 1000,
      glacialMurkiness: 0.8,
      pollenAmount: 0,
      frostAmount: 1,
    },
    {
      at: 0.6,
      green: 1,
      autumn: 0.5,
      bloom: 0.7,
      snowlineM: 2000,
      glacialMurkiness: 0.4,
      pollenAmount: 0.8,
      frostAmount: 0,
    },
  ],
  morningMist: {
    startSunElevationDeg: -5,
    peakSunElevationDeg: 5,
    endSunElevationDeg: 15,
    strength: 0.8,
  },
  defaultWetness: 0.25,
};

describe("biome visual state", () => {
  it("interpolates seasonal values without independent consumer curves", () => {
    const state = evaluateBiomeVisualState(SETTINGS, { seasonT: 0.35, sunElevationDeg: 5 });

    expect(state.green).toBeCloseTo(0.6, 6);
    expect(state.bloom).toBeCloseTo(0.4, 6);
    expect(state.snowlineM).toBeCloseTo(1500, 6);
    expect(state.morningMist).toBeCloseTo(0.8, 6);
    expect(state.wetness).toBeCloseTo(0.25, 6);
  });

  it("interpolates cyclically across the end of the year", () => {
    const late = evaluateBiomeVisualState(SETTINGS, { seasonT: 0.85, sunElevationDeg: 20 });
    const early = evaluateBiomeVisualState(SETTINGS, { seasonT: -0.15, sunElevationDeg: 20 });

    expect(early.seasonT).toBeCloseTo(0.85, 6);
    expect(early.green).toBeCloseTo(late.green, 6);
    expect(early.frostAmount).toBeCloseTo(late.frostAmount, 6);
  });

  it("uses a bounded morning mist window and clamps external wetness", () => {
    expect(evaluateBiomeVisualState(SETTINGS, { seasonT: 0, sunElevationDeg: -5 }).morningMist).toBe(0);
    expect(evaluateBiomeVisualState(SETTINGS, { seasonT: 0, sunElevationDeg: 0 }).morningMist).toBeCloseTo(0.4, 6);
    expect(evaluateBiomeVisualState(SETTINGS, { seasonT: 0, sunElevationDeg: 10 }).morningMist).toBeCloseTo(0.4, 6);
    expect(evaluateBiomeVisualState(SETTINGS, { seasonT: 0, sunElevationDeg: 15 }).morningMist).toBe(0);
    expect(evaluateBiomeVisualState(SETTINGS, { seasonT: 0, sunElevationDeg: 5, wetness: 2 }).wetness).toBe(1);
  });

  it("publishes the feature flag without hiding configured values", () => {
    const state = evaluateBiomeVisualState({ ...SETTINGS, enabled: false }, {
      seasonT: 0.35,
      sunElevationDeg: 5,
    });

    expect(state.enabled).toBe(false);
    expect(state.green).toBeCloseTo(0.6, 6);
  });
});
