import { describe, expect, it } from "vitest";
import { createLargePropOcclusionSample } from "../props/large_prop_occlusion_field.js";
import { riverMistPropTransmission } from "./river_mist_prop_occlusion.js";

describe("river mist prop occlusion", () => {
  it("attenuates fog inside an active prop volume", () => {
    const sample = createLargePropOcclusionSample();
    Object.assign(sample, {
      valid: true,
      enabled: true,
      fogOccupancy: 0.75,
      fogBottomY: 2,
      fogTopY: 8,
    });

    expect(riverMistPropTransmission(sample, 4, 0.8)).toBeCloseTo(0.4);
  });

  it("fails open for unavailable, disabled, empty, or vertically separate fields", () => {
    const sample = createLargePropOcclusionSample();
    expect(riverMistPropTransmission(sample, 4, 1)).toBe(1);

    Object.assign(sample, {
      valid: true,
      enabled: false,
      fogOccupancy: 1,
      fogBottomY: 2,
      fogTopY: 8,
    });
    expect(riverMistPropTransmission(sample, 4, 1)).toBe(1);

    sample.enabled = true;
    sample.fogOccupancy = 0;
    expect(riverMistPropTransmission(sample, 4, 1)).toBe(1);

    sample.fogOccupancy = 1;
    expect(riverMistPropTransmission(sample, 9, 1)).toBe(1);
    expect(riverMistPropTransmission(sample, 1, 1)).toBe(1);
  });

  it("clamps unsafe strength values", () => {
    const sample = createLargePropOcclusionSample();
    Object.assign(sample, {
      valid: true,
      enabled: true,
      fogOccupancy: 0.5,
      fogBottomY: 0,
      fogTopY: 10,
    });

    expect(riverMistPropTransmission(sample, 5, -2)).toBe(1);
    expect(riverMistPropTransmission(sample, 5, 8)).toBe(0.5);
  });
});
