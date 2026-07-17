import { describe, expect, it } from "vitest";
import {
  applyPostProcessQualityPreset,
  isPostProcessQualityPreset,
  type PostProcessQualityPreset,
  type PostProcessQualityPresetState,
} from "./postprocess_quality_presets.js";

function createState(): PostProcessQualityPresetState {
  return {
    postProcessQualityPreset: "custom",
    postProcessEnabled: false,
    postProcessRenderScale: 1,
    postProcessBloomEnabled: true,
    postProcessFxaaEnabled: true,
    postProcessTaaEnabled: false,
    postProcessTaaJitterEnabled: true,
    postProcessTaaHistoryClampEnabled: true,
    postProcessContactShadowsEnabled: false,
    postProcessClarityEnabled: true,
    postProcessAerialPerspectiveEnabled: true,
    postProcessCloudsEnabled: true,
    postProcessGtaoEnabled: true,
    postProcessFroxelsEnabled: true,
    postProcessBounceEnabled: true,
    godRaysMode: "off",
  };
}

describe("postprocess quality presets", () => {
  it.each<[string | null, boolean]>([
    ["custom", true],
    ["ultra", true],
    ["balanced", true],
    ["perf", true],
    ["potato", true],
    ["unknown", false],
    [null, false],
  ])("validates preset value %s", (value, expected) => {
    expect(isPostProcessQualityPreset(value)).toBe(expected);
  });

  it("keeps custom as a marker without changing settings", () => {
    const state = createState();
    state.postProcessRenderScale = 0.75;
    applyPostProcessQualityPreset(state, "custom");

    expect(state.postProcessQualityPreset).toBe("custom");
    expect(state.postProcessRenderScale).toBe(0.75);
  });

  it.each<[PostProcessQualityPreset, Partial<PostProcessQualityPresetState>]>([
    ["ultra", {
      postProcessRenderScale: 1,
      postProcessBloomEnabled: true,
      postProcessFxaaEnabled: true,
      postProcessTaaEnabled: true,
      postProcessContactShadowsEnabled: true,
      postProcessClarityEnabled: true,
      postProcessAerialPerspectiveEnabled: true,
      postProcessCloudsEnabled: true,
      godRaysMode: "volumetric",
    }],
    ["balanced", {
      postProcessRenderScale: 0.85,
      postProcessBloomEnabled: true,
      postProcessFxaaEnabled: true,
      postProcessTaaEnabled: true,
      postProcessContactShadowsEnabled: true,
      postProcessClarityEnabled: true,
      postProcessAerialPerspectiveEnabled: true,
      postProcessCloudsEnabled: true,
      godRaysMode: "heavy",
    }],
    ["perf", {
      postProcessRenderScale: 0.75,
      postProcessBloomEnabled: false,
      postProcessFxaaEnabled: true,
      postProcessTaaEnabled: false,
      postProcessContactShadowsEnabled: false,
      postProcessClarityEnabled: true,
      postProcessAerialPerspectiveEnabled: true,
      postProcessCloudsEnabled: false,
      godRaysMode: "cheap",
    }],
    ["potato", {
      postProcessRenderScale: 0.5,
      postProcessBloomEnabled: false,
      postProcessFxaaEnabled: true,
      postProcessTaaEnabled: false,
      postProcessContactShadowsEnabled: false,
      postProcessClarityEnabled: false,
      postProcessAerialPerspectiveEnabled: false,
      postProcessCloudsEnabled: false,
      godRaysMode: "off",
    }],
  ])("applies %s", (preset, expected) => {
    const state = createState();
    applyPostProcessQualityPreset(state, preset);

    expect(state).toMatchObject({
      postProcessQualityPreset: preset,
      postProcessEnabled: true,
      ...expected,
    });
  });
});
