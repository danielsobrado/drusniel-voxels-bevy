import { describe, expect, it } from "vitest";
import { cloneWaterConfig } from "./water_config_clone.js";
import { DEFAULT_WATER_CONFIG } from "./water_config_defaults.js";
import { applyWaterReferencePreset } from "./water_reference_presets.js";

describe("water reference presets", () => {
  it("applies the stable Fable5-inspired response", () => {
    const visual = cloneWaterConfig(DEFAULT_WATER_CONFIG).visual;

    applyWaterReferencePreset(visual, "fable5");

    expect(visual.rippleAmp).toBe(0.10);
    expect(visual.fresnel.normalFlatten).toBe(0.97);
    expect(visual.glitter.tightExponent).toBe(160);
    expect(visual.glitter.tightGain).toBe(0.28);
  });

  it("applies the stronger Glacial Valley response", () => {
    const visual = cloneWaterConfig(DEFAULT_WATER_CONFIG).visual;

    applyWaterReferencePreset(visual, "glacial");

    expect(visual.rippleAmp).toBe(0.20);
    expect(visual.fresnel.normalFlatten).toBe(0.92);
    expect(visual.glitter.tightExponent).toBe(320);
    expect(visual.glitter.tightGain).toBe(0.45);
  });

  it("leaves custom values unchanged", () => {
    const visual = cloneWaterConfig(DEFAULT_WATER_CONFIG).visual;
    visual.rippleAmp = 0.713;

    applyWaterReferencePreset(visual, "custom");

    expect(visual.rippleAmp).toBe(0.713);
  });
});
