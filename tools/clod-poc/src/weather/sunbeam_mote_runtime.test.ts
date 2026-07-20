import { beforeEach, describe, expect, it } from "vitest";
import {
  cloneEnvironmentalMaskSettings,
  DEFAULT_ENVIRONMENTAL_MASK_SETTINGS,
} from "../environment_masks/environment_mask_config.js";
import { evaluateSunbeamMoteAirborneState } from "../environment_masks/sunbeam_mote_mask_state.js";
import { setEnvironmentalMaskSettings } from "../environment_masks/environment_mask_runtime.js";
import {
  readSunbeamMoteRuntimeSettings,
  resolveSunbeamMoteVisualState,
  sanitizeSunbeamMoteRuntimeSettings,
} from "./sunbeam_mote_runtime.js";

beforeEach(() => {
  setEnvironmentalMaskSettings(cloneEnvironmentalMaskSettings(DEFAULT_ENVIRONMENTAL_MASK_SETTINGS));
});

describe("sunbeam mote runtime", () => {
  it("uses an explicit runtime initial state rather than a URL flag", () => {
    expect(readSunbeamMoteRuntimeSettings(false).enabled).toBe(false);
    expect(readSunbeamMoteRuntimeSettings(true).enabled).toBe(true);
  });

  it("fails closed when the shared mask capability is disabled", () => {
    const settings = cloneEnvironmentalMaskSettings();
    settings.sunbeamMote.enabled = false;
    setEnvironmentalMaskSettings(settings);
    expect(readSunbeamMoteRuntimeSettings(true).enabled).toBe(false);
  });

  it("sanitizes live lil-gui patches", () => {
    const sanitized = sanitizeSunbeamMoteRuntimeSettings({
      ...readSunbeamMoteRuntimeSettings(true),
      maxParticles: Number.POSITIVE_INFINITY,
      spawnRadiusM: 500,
      fadeStartM: 200,
      fadeEndM: -10,
      visibilityStart: 0.8,
      visibilityEnd: 0.2,
      density: -1,
      opacity: 4,
    });
    expect(sanitized.maxParticles).toBe(1200);
    expect(sanitized.spawnRadiusM).toBe(96);
    expect(sanitized.fadeStartM).toBe(96);
    expect(sanitized.fadeEndM).toBe(96);
    expect(sanitized.visibilityEnd).toBe(0.8);
    expect(sanitized.density).toBe(0);
    expect(sanitized.opacity).toBe(1);
  });

  it("uses the canonical airborne state for pollen, frost, and morning mist", () => {
    expect(resolveSunbeamMoteVisualState(null)).toEqual({ amount: 0, coldBlend: 0, localMist: 0 });

    const warm = { enabled: true, pollenAmount: 0.8, frostAmount: 0, morningMist: 0.4 };
    expect(resolveSunbeamMoteVisualState(warm)).toEqual(evaluateSunbeamMoteAirborneState(warm));
    expect(resolveSunbeamMoteVisualState(warm)).toEqual({ amount: 0.8, coldBlend: 0, localMist: 0.4 });

    const mixed = { enabled: true, pollenAmount: 0.3, frostAmount: 0.7, morningMist: 0.2 };
    expect(resolveSunbeamMoteVisualState(mixed)).toEqual(evaluateSunbeamMoteAirborneState(mixed));
    expect(resolveSunbeamMoteVisualState(mixed).amount).toBe(1);
    expect(resolveSunbeamMoteVisualState(mixed).coldBlend).toBeCloseTo(0.7);

    expect(resolveSunbeamMoteVisualState({
      enabled: true,
      pollenAmount: 0,
      frostAmount: 0,
      morningMist: 0.65,
    })).toEqual({ amount: 0.65, coldBlend: 0, localMist: 0.65 });

    expect(resolveSunbeamMoteVisualState({
      enabled: true,
      pollenAmount: 0,
      frostAmount: 0.6,
      morningMist: 0,
    })).toEqual({ amount: 0.6, coldBlend: 1, localMist: 0 });
  });
});
