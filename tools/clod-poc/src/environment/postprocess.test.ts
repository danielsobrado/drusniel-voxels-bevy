import { describe, expect, it } from "vitest";
import {
  DEFAULT_POST_PROCESS_SETTINGS,
  GOD_RAYS_SCREEN_SAMPLES,
  POSTPROCESS_SHADER_TEST_HOOKS,
} from "./postprocess.js";

describe("DEFAULT_POST_PROCESS_SETTINGS", () => {
  it("uses a neutral output pass", () => {
    expect(DEFAULT_POST_PROCESS_SETTINGS).toEqual({
      enabled: true,
      opacity: 1,
      exposure: 1,
      contrast: 1,
      saturation: 1,
      vignette: 0,
      debugMode: "output",
      godRaysMode: "off",
      godRaysDensity: 0.96,
      godRaysDecay: 0.92,
      godRaysWeight: 0.35,
      godRaysExposure: 0.6,
    });
  });

  it("defaults god rays off so existing scenes are unchanged", () => {
    expect(DEFAULT_POST_PROCESS_SETTINGS.godRaysMode).toBe("off");
  });
});

describe("GOD_RAYS_SCREEN_SAMPLES", () => {
  it("spends a larger raymarch budget on the heavy screen-space mode", () => {
    expect(GOD_RAYS_SCREEN_SAMPLES.heavy).toBeGreaterThan(GOD_RAYS_SCREEN_SAMPLES.cheap);
  });
});

describe("postprocess shaders", () => {
  it("declares the copy pass uniforms", () => {
    expect(POSTPROCESS_SHADER_TEST_HOOKS.copyFragment).toContain("tDiffuse");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.copyFragment).toContain("uOpacity");
  });

  it("declares the output pass uniforms", () => {
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("tDiffuse");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uExposure");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uContrast");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uSaturation");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uVignette");
  });
});
