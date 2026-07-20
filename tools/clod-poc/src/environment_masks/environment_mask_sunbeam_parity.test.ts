import { describe, expect, it } from "vitest";
import type { BiomeVisualState } from "../environment/biome_visual_state.js";
import { cloneEnvironmentalMaskSettings } from "./environment_mask_config.js";
import {
  createEnvironmentalMaskValues,
  evaluateEnvironmentalMaskValues,
} from "./environment_mask_math.js";
import { evaluateSunbeamMoteMaskValue } from "./sunbeam_mote_mask_state.js";

const baseBiome: BiomeVisualState = Object.freeze({
  enabled: true,
  seasonT: 0.5,
  green: 0.8,
  autumn: 0.1,
  bloom: 0.2,
  snowlineM: 70,
  glacialMurkiness: 0.7,
  morningMist: 0,
  pollenAmount: 0,
  frostAmount: 0,
  wetness: 0.4,
});

function evaluate(biome: BiomeVisualState, visibilityValid = true, sunVisibility = 0.7): number {
  const settings = cloneEnvironmentalMaskSettings();
  const values = evaluateEnvironmentalMaskValues({
    settings,
    biome,
    waterValid: false,
    riverValid: false,
    normalValid: false,
    visibilityValid,
    wetMask: 0,
    bodyKind: 0,
    waterDepth: 0,
    shoreDistanceM: 0,
    flowStrength: 0,
    bedDrop: 0,
    rapidMask: 0,
    normalY: 0,
    sunVisibility,
  }, createEnvironmentalMaskValues());
  const expected = evaluateSunbeamMoteMaskValue({
    settings: settings.sunbeamMote,
    biome,
    visibilityValid,
    sunVisibility,
  });
  expect(values.sunbeamMote).toBeCloseTo(expected, 10);
  return values.sunbeamMote;
}

describe("environmental sunbeam mote parity", () => {
  it("matches the canonical helper for morning-mist-only state", () => {
    expect(evaluate({ ...baseBiome, morningMist: 0.75 })).toBeGreaterThan(0);
  });

  it("matches the canonical helper for frost-only state", () => {
    expect(evaluate({ ...baseBiome, frostAmount: 0.65 })).toBeGreaterThan(0);
  });

  it("matches the canonical helper for mixed pollen and frost", () => {
    expect(evaluate({ ...baseBiome, pollenAmount: 0.3, frostAmount: 0.6 })).toBeGreaterThan(0);
  });

  it("fails closed when visibility authority is invalid", () => {
    expect(evaluate({ ...baseBiome, morningMist: 1, pollenAmount: 1, frostAmount: 1 }, false, 1)).toBe(0);
  });
});
