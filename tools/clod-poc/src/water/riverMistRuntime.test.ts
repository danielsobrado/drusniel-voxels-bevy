import { beforeEach, describe, expect, it } from "vitest";
import type { BiomeVisualState } from "../environment/biome_visual_state.js";
import {
  cloneEnvironmentalMaskSettings,
  DEFAULT_ENVIRONMENTAL_MASK_SETTINGS,
} from "../environment_masks/environment_mask_config.js";
import { setEnvironmentalMaskSettings } from "../environment_masks/environment_mask_runtime.js";
import { HYDROLOGY_BODY_LAKE, HYDROLOGY_BODY_RIVER } from "./hydrologyGrid.js";
import type { WaterFieldResult } from "./waterField.js";
import { readRiverMistRuntimeSettings, riverMistSignal } from "./riverMistRuntime.js";

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
  it("accepts every supported opt-in alias", () => {
    expect(readRiverMistRuntimeSettings(new URLSearchParams("riverMist=1")).enabled).toBe(true);
    expect(readRiverMistRuntimeSettings(new URLSearchParams("waterRiverMist=1")).enabled).toBe(true);
    expect(readRiverMistRuntimeSettings(new URLSearchParams("coldRiverMist=1")).enabled).toBe(true);
  });

  it("stays disabled without an explicit opt-in", () => {
    expect(readRiverMistRuntimeSettings(new URLSearchParams()).enabled).toBe(false);
  });

  it("fails closed for disabled or ineffective shared settings", () => {
    const settings = cloneEnvironmentalMaskSettings();
    settings.riverMist.enabled = false;
    setEnvironmentalMaskSettings(settings);
    expect(readRiverMistRuntimeSettings(new URLSearchParams("riverMist=1")).enabled).toBe(false);

    settings.riverMist.enabled = true;
    settings.riverMist.particles.maxParticles = 0;
    setEnvironmentalMaskSettings(settings);
    expect(readRiverMistRuntimeSettings(new URLSearchParams("riverMist=1")).enabled).toBe(false);
  });

  it("requires a valid flowing river near its shoreline", () => {
    const settings = readRiverMistRuntimeSettings(new URLSearchParams("riverMist=1"));
    expect(riverMistSignal(riverSample(), biome, settings)).toBeGreaterThan(0);
    expect(riverMistSignal(riverSample({ bodyKind: HYDROLOGY_BODY_LAKE }), biome, settings)).toBe(0);
    expect(riverMistSignal(riverSample({ shoreDistance: -1 }), biome, settings)).toBe(0);
    expect(riverMistSignal(riverSample({ flow: { x: 1, z: 0, speed: 0, progress: 0, drop: 0 } }), biome, settings)).toBe(0);
    expect(riverMistSignal(riverSample(), { enabled: true, morningMist: 0 }, settings)).toBe(0);
  });
});
