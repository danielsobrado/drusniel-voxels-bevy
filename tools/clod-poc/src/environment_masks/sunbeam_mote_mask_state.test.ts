import { describe, expect, it } from "vitest";
import { cloneEnvironmentalMaskSettings } from "./environment_mask_config.js";
import {
  evaluateSunbeamMoteAirborneState,
  evaluateSunbeamMoteMaskValue,
} from "./sunbeam_mote_mask_state.js";

const enabledBiome = {
  enabled: true,
  morningMist: 0.35,
  pollenAmount: 0.4,
  frostAmount: 0.2,
};

describe("sunbeam mote mask state", () => {
  it("combines seasonal particles without losing morning mist", () => {
    const seasonal = evaluateSunbeamMoteAirborneState(enabledBiome);
    expect(seasonal.amount).toBeCloseTo(0.6);
    expect(seasonal.coldBlend).toBeCloseTo(1 / 3);
    expect(seasonal.localMist).toBeCloseTo(0.35);
    expect(evaluateSunbeamMoteAirborneState({
      enabled: true,
      morningMist: 0.75,
      pollenAmount: 0.1,
      frostAmount: 0,
    })).toEqual({ amount: 0.75, coldBlend: 0, localMist: 0.75 });
  });

  it("keeps frost-only motes cold and pollen-only motes warm", () => {
    expect(evaluateSunbeamMoteAirborneState({
      enabled: true,
      morningMist: 0,
      pollenAmount: 0,
      frostAmount: 0.65,
    })).toEqual({ amount: 0.65, coldBlend: 1, localMist: 0 });
    expect(evaluateSunbeamMoteAirborneState({
      enabled: true,
      morningMist: 0,
      pollenAmount: 0.65,
      frostAmount: 0,
    })).toEqual({ amount: 0.65, coldBlend: 0, localMist: 0 });
  });

  it("fails closed for disabled biome state and invalid visibility", () => {
    const settings = cloneEnvironmentalMaskSettings().sunbeamMote;
    expect(evaluateSunbeamMoteAirborneState({ ...enabledBiome, enabled: false })).toEqual({
      amount: 0,
      coldBlend: 0,
      localMist: 0,
    });
    expect(evaluateSunbeamMoteMaskValue({
      settings,
      biome: enabledBiome,
      visibilityValid: false,
      sunVisibility: 1,
    })).toBe(0);
  });

  it("applies the configured visibility ramp and strength", () => {
    const settings = cloneEnvironmentalMaskSettings().sunbeamMote;
    settings.strength = 0.5;
    settings.visibilityStart = 0.2;
    settings.visibilityEnd = 0.8;
    const dark = evaluateSunbeamMoteMaskValue({
      settings,
      biome: enabledBiome,
      visibilityValid: true,
      sunVisibility: 0.2,
    });
    const middle = evaluateSunbeamMoteMaskValue({
      settings,
      biome: enabledBiome,
      visibilityValid: true,
      sunVisibility: 0.5,
    });
    const bright = evaluateSunbeamMoteMaskValue({
      settings,
      biome: enabledBiome,
      visibilityValid: true,
      sunVisibility: 0.8,
    });
    expect(dark).toBe(0);
    expect(middle).toBeCloseTo(0.15);
    expect(bright).toBeCloseTo(0.3);
  });
});
