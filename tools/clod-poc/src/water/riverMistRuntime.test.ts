import { beforeEach, describe, expect, it } from "vitest";
import type { BiomeVisualState } from "../environment/biome_visual_state.js";
import { cloneEnvironmentalMaskSettings, DEFAULT_ENVIRONMENTAL_MASK_SETTINGS } from "../environment_masks/environment_mask_config.js";
import { setEnvironmentalMaskSettings } from "../environment_masks/environment_mask_runtime.js";
import { HYDROLOGY_BODY_LAKE, HYDROLOGY_BODY_RIVER } from "./hydrologyGrid.js";
import type { WaterFieldResult } from "./waterField.js";
import { readRiverMistRuntimeSettings, riverMistInitialEnabled, riverMistSignal } from "./riverMistRuntime.js";

const biome = { enabled: true, morningMist: 1 } as Pick<BiomeVisualState, "enabled" | "morningMist">;

function riverSample(overrides: Partial<WaterFieldResult> = {}): WaterFieldResult {
  return {
    waterY: 4,
    terrainY: 3.4,
    depth: 0.6,
    bodyMask: 1,
    bodyKind: HYDROLOGY_BODY_RIVER,
    shoreDistance: 2,
    flow: { x: 1, z: 0, speed: 0.2, progress: 0, drop: 0 },
    ...overrides,
  };
}

beforeEach(() => {
  setEnvironmentalMaskSettings(cloneEnvironmentalMaskSettings(DEFAULT_ENVIRONMENTAL_MASK_SETTINGS));
});

describe("river mist runtime", () => {
  it("uses URL aliases only to seed the initial lil-gui state", () => {
    expect(riverMistInitialEnabled(new URLSearchParams("riverMist=1"))).toBe(true);
    expect(riverMistInitialEnabled(new URLSearchParams("waterRiverMist=1"))).toBe(true);
    expect(riverMistInitialEnabled(new URLSearchParams("coldRiverMist=1"))).toBe(true);
    expect(riverMistInitialEnabled(new URLSearchParams())).toBe(false);
  });

  it("keeps capability independent from activation", () => {
    expect(readRiverMistRuntimeSettings().enabled).toBe(true);
  });

  it("fails closed for disabled or ineffective shared settings", () => {
    const settings = cloneEnvironmentalMaskSettings();
    settings.riverMist.enabled = false;
    setEnvironmentalMaskSettings(settings);
    expect(readRiverMistRuntimeSettings().enabled).toBe(false);

    settings.riverMist.enabled = true;
    settings.riverMist.particles.maxParticles = 0;
    setEnvironmentalMaskSettings(settings);
    expect(readRiverMistRuntimeSettings().enabled).toBe(false);
  });

  it("requires a valid flowing river near its shoreline", () => {
    const settings = readRiverMistRuntimeSettings();
    expect(riverMistSignal(riverSample(), biome, settings)).toBeGreaterThan(0);
    expect(riverMistSignal(riverSample({ bodyKind: HYDROLOGY_BODY_LAKE }), biome, settings)).toBe(0);
    expect(riverMistSignal(riverSample({ shoreDistance: -1 }), biome, settings)).toBe(0);
    expect(riverMistSignal(riverSample({ depth: Number.NaN }), biome, settings)).toBe(0);
    expect(riverMistSignal(riverSample({ flow: { x: 1, z: 0, speed: 0, progress: 0, drop: 0 } }), biome, settings)).toBe(0);
    expect(riverMistSignal(riverSample(), { enabled: true, morningMist: 0 }, settings)).toBe(0);
  });
});
