import { describe, expect, it } from "vitest";
import { DEFAULT_POST_PROCESS_SETTINGS } from "../environment/postprocess.js";
import { postProcessOutputGraphDirty } from "./webgpu_postprocess.js";

describe("postProcessOutputGraphDirty", () => {
  it("stays false when the frame loop re-applies the same full settings object", () => {
    const current = { ...DEFAULT_POST_PROCESS_SETTINGS };
    expect(postProcessOutputGraphDirty(current, current)).toBe(false);
  });

  it("rebuilds when enabled or debug mode actually change", () => {
    const current = { ...DEFAULT_POST_PROCESS_SETTINGS };
    expect(postProcessOutputGraphDirty(current, { enabled: false })).toBe(true);
    expect(postProcessOutputGraphDirty(current, { debugMode: "copy" })).toBe(true);
  });

  it("rebuilds when effect graph stages change", () => {
    const current = { ...DEFAULT_POST_PROCESS_SETTINGS };
    expect(postProcessOutputGraphDirty(current, { bloomEnabled: !current.bloomEnabled })).toBe(true);
    expect(postProcessOutputGraphDirty(current, { taaEnabled: !current.taaEnabled })).toBe(true);
    expect(postProcessOutputGraphDirty(current, { aerialPerspectiveEnabled: !current.aerialPerspectiveEnabled })).toBe(true);
    expect(postProcessOutputGraphDirty(current, { contactShadowsEnabled: !current.contactShadowsEnabled })).toBe(true);
    expect(postProcessOutputGraphDirty(current, { cloudsEnabled: !current.cloudsEnabled })).toBe(true);
    expect(postProcessOutputGraphDirty(current, { gtaoEnabled: !current.gtaoEnabled })).toBe(true);
    expect(postProcessOutputGraphDirty(current, { froxelsEnabled: !current.froxelsEnabled })).toBe(true);
    expect(postProcessOutputGraphDirty(current, { bounceEnabled: !current.bounceEnabled })).toBe(true);
    expect(postProcessOutputGraphDirty(current, { godRaysMode: current.godRaysMode === "off" ? "cheap" : "off" })).toBe(true);
  });

  it("rebuilds when bloom node constants change", () => {
    const current = { ...DEFAULT_POST_PROCESS_SETTINGS };
    expect(postProcessOutputGraphDirty(current, { bloomThreshold: current.bloomThreshold + 0.01 })).toBe(true);
    expect(postProcessOutputGraphDirty(current, { bloomStrength: current.bloomStrength + 0.01 })).toBe(true);
    expect(postProcessOutputGraphDirty(current, { bloomRadius: current.bloomRadius + 0.01 })).toBe(true);
  });

  it("does not rebuild when only grading uniforms change", () => {
    const current = { ...DEFAULT_POST_PROCESS_SETTINGS };
    expect(postProcessOutputGraphDirty(current, {
      exposure: 1.2,
      contrast: 0.9,
      saturation: 1.1,
      vignette: 0.2,
      opacity: 0.8,
    })).toBe(false);
  });

  it("does not rebuild when only contact shadow uniforms change", () => {
    const current = { ...DEFAULT_POST_PROCESS_SETTINGS, contactShadowsEnabled: true };
    expect(postProcessOutputGraphDirty(current, {
      contactShadowsStrength: current.contactShadowsStrength + 0.05,
      contactShadowsRadiusPx: current.contactShadowsRadiusPx + 0.25,
      contactShadowsDepthBias: current.contactShadowsDepthBias + 0.001,
    })).toBe(false);
  });

  it("does not rebuild when only god-rays uniforms change", () => {
    const current = { ...DEFAULT_POST_PROCESS_SETTINGS };
    expect(postProcessOutputGraphDirty(current, {
      godRaysDensity: current.godRaysDensity + 0.01,
      godRaysDecay: current.godRaysDecay - 0.01,
      godRaysWeight: current.godRaysWeight + 0.01,
      godRaysExposure: current.godRaysExposure + 0.01,
      godRaysDustStrength: current.godRaysDustStrength + 0.01,
      godRaysDustScale: current.godRaysDustScale + 0.1,
      godRaysDustSpeed: current.godRaysDustSpeed + 0.01,
    })).toBe(false);
  });
});
