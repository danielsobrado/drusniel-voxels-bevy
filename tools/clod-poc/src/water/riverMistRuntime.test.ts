import { beforeEach, describe, expect, it } from "vitest";
import type { BiomeVisualState } from "../environment/biome_visual_state.js";
import { cloneEnvironmentalMaskSettings, DEFAULT_ENVIRONMENTAL_MASK_SETTINGS } from "../environment_masks/environment_mask_config.js";
import {
  createEnvironmentalMaskValues,
  evaluateEnvironmentalMaskValues,
} from "../environment_masks/environment_mask_math.js";
import { setEnvironmentalMaskSettings } from "../environment_masks/environment_mask_runtime.js";
import type { EnvironmentQueryMeta, RiverQueryResult, WaterQueryResult } from "../environment_query/types.js";
import { HYDROLOGY_BODY_LAKE, HYDROLOGY_BODY_RIVER } from "./hydrologyGrid.js";
import type { WaterFieldResult } from "./waterField.js";
import {
  readRiverMistRuntimeSettings,
  riverMistInitialEnabled,
  riverMistSampleFromEnvironment,
  riverMistSampleFromWaterField,
  riverMistSignal,
  type RiverMistSample,
} from "./riverMistRuntime.js";

const biome: BiomeVisualState = Object.freeze({
  enabled: true,
  seasonT: 0.25,
  green: 0.8,
  autumn: 0.1,
  bloom: 0.4,
  snowlineM: 80,
  glacialMurkiness: 0.7,
  morningMist: 1,
  pollenAmount: 0.3,
  frostAmount: 0.1,
  wetness: 0.4,
});
const validMeta: EnvironmentQueryMeta = {
  source: "hydrology-cpu",
  revision: 3,
  valid: true,
  cellSizeM: 16,
};

function riverSample(overrides: Partial<RiverMistSample> = {}): RiverMistSample {
  return {
    waterY: 4,
    depth: 0.6,
    wetMask: 1,
    bodyKind: HYDROLOGY_BODY_RIVER,
    shoreDistanceM: 2,
    flowX: 1,
    flowZ: 0,
    flowStrength: 0.2,
    ...overrides,
  };
}

function queryWater(overrides: Partial<WaterQueryResult> = {}): WaterQueryResult {
  return {
    waterY: 4,
    carvedBedY: 3.4,
    depth: 0.6,
    wetMask: 1,
    shoreDistanceM: 2,
    bodyKind: HYDROLOGY_BODY_RIVER,
    bodyId: 7,
    meta: validMeta,
    ...overrides,
  };
}

function queryRiver(overrides: Partial<RiverQueryResult> = {}): RiverQueryResult {
  return {
    flowX: 1,
    flowZ: 0,
    flowStrength: 0.2,
    bedDrop: 0,
    rapidMask: 0,
    channelCenterWeight: 1,
    bankContactWeight: 0,
    gravelBarMask: 0,
    meta: validMeta,
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

  it("maps valid environment-query water and river fields", () => {
    expect(riverMistSampleFromEnvironment(queryWater(), queryRiver())).toEqual(riverSample());
    expect(riverMistSampleFromEnvironment(
      queryWater({ meta: { ...validMeta, valid: false } }),
      queryRiver(),
    )).toBeNull();
    expect(riverMistSampleFromEnvironment(
      queryWater(),
      queryRiver({ flowStrength: Number.NaN }),
    )).toBeNull();
  });

  it("keeps the legacy field adapter equivalent", () => {
    const fieldSample: WaterFieldResult = {
      waterY: 4,
      terrainY: 3.4,
      depth: 0.6,
      bodyMask: 1,
      bodyKind: HYDROLOGY_BODY_RIVER,
      shoreDistance: 2,
      flow: { x: 1, z: 0, speed: 0.2, progress: 0, drop: 0 },
    };
    expect(riverMistSampleFromWaterField(fieldSample)).toEqual(riverSample());
  });

  it("uses the same shared mask result as the generic environmental evaluator", () => {
    const sharedSettings = cloneEnvironmentalMaskSettings();
    setEnvironmentalMaskSettings(sharedSettings);
    const sample = riverSample();
    const runtimeValue = riverMistSignal(sample, biome, readRiverMistRuntimeSettings());
    const values = evaluateEnvironmentalMaskValues({
      settings: sharedSettings,
      biome,
      waterValid: true,
      riverValid: true,
      normalValid: false,
      visibilityValid: false,
      wetMask: sample.wetMask,
      bodyKind: sample.bodyKind,
      waterDepth: sample.depth,
      shoreDistanceM: sample.shoreDistanceM,
      flowStrength: sample.flowStrength,
      bedDrop: 0,
      rapidMask: 0,
      normalY: 0,
      sunVisibility: 0,
    }, createEnvironmentalMaskValues());

    expect(runtimeValue).toBeCloseTo(values.riverMist, 10);
  });

  it("requires a valid flowing river near its shoreline", () => {
    const settings = readRiverMistRuntimeSettings();
    expect(riverMistSignal(riverSample(), biome, settings)).toBeGreaterThan(0);
    expect(riverMistSignal(riverSample({ bodyKind: HYDROLOGY_BODY_LAKE }), biome, settings)).toBe(0);
    expect(riverMistSignal(riverSample({ shoreDistanceM: -1 }), biome, settings)).toBe(0);
    expect(riverMistSignal(riverSample({ depth: 0.02 }), biome, settings)).toBe(0);
    expect(riverMistSignal(riverSample({ wetMask: 0.05 }), biome, settings)).toBe(0);
    expect(riverMistSignal(riverSample({ depth: Number.NaN }), biome, settings)).toBe(0);
    expect(riverMistSignal(riverSample({ flowStrength: 0 }), biome, settings)).toBe(0);
    expect(riverMistSignal(riverSample(), { ...biome, morningMist: 0 }, settings)).toBe(0);
  });
});
