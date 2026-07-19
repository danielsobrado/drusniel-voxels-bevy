import { describe, expect, it } from "vitest";
import { HYDROLOGY_BODY_LAKE, HYDROLOGY_BODY_RIVER } from "../water/hydrologyGrid.js";
import { cloneEnvironmentalMaskSettings } from "./environment_mask_config.js";
import {
  evaluateRiverMistMaskValue,
  type RiverMistMaskMathInput,
} from "./environment_mask_math.js";

function input(overrides: Partial<RiverMistMaskMathInput> = {}): RiverMistMaskMathInput {
  return {
    settings: cloneEnvironmentalMaskSettings().riverMist,
    biomeEnabled: true,
    morningMist: 1,
    waterValid: true,
    riverValid: true,
    wetMask: 1,
    bodyKind: HYDROLOGY_BODY_RIVER,
    waterDepth: 0.6,
    shoreDistanceM: 2,
    flowStrength: 0.2,
    ...overrides,
  };
}

describe("river mist environmental mask", () => {
  it("produces a bounded signal for a valid flowing river cell", () => {
    const value = evaluateRiverMistMaskValue(input());
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThanOrEqual(1);
  });

  it("fails closed for invalid authorities and non-river bodies", () => {
    expect(evaluateRiverMistMaskValue(input({ waterValid: false }))).toBe(0);
    expect(evaluateRiverMistMaskValue(input({ riverValid: false }))).toBe(0);
    expect(evaluateRiverMistMaskValue(input({ bodyKind: HYDROLOGY_BODY_LAKE }))).toBe(0);
  });

  it("rejects dry, shallow, malformed, and zero-flow samples", () => {
    expect(evaluateRiverMistMaskValue(input({ wetMask: 0.05 }))).toBe(0);
    expect(evaluateRiverMistMaskValue(input({ waterDepth: 0.02 }))).toBe(0);
    expect(evaluateRiverMistMaskValue(input({ shoreDistanceM: -1 }))).toBe(0);
    expect(evaluateRiverMistMaskValue(input({ flowStrength: 0 }))).toBe(0);
    expect(evaluateRiverMistMaskValue(input({ waterDepth: Number.NaN }))).toBe(0);
  });

  it("requires the shared biome and mask capability", () => {
    expect(evaluateRiverMistMaskValue(input({ biomeEnabled: false }))).toBe(0);
    expect(evaluateRiverMistMaskValue(input({ morningMist: 0 }))).toBe(0);
    const settings = cloneEnvironmentalMaskSettings().riverMist;
    settings.enabled = false;
    expect(evaluateRiverMistMaskValue(input({ settings }))).toBe(0);
  });
});
