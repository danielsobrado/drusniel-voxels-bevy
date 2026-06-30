import { describe, expect, it } from "vitest";
import {
  DEFAULT_POST_PROCESS_SETTINGS,
  GOD_RAYS_SCREEN_SAMPLES,
  POSTPROCESS_SHADER_TEST_HOOKS,
  parsePostProcessSettings,
} from "./postprocess.js";

describe("DEFAULT_POST_PROCESS_SETTINGS", () => {
  it("loads the YAML-backed output pass defaults", () => {
    expect(DEFAULT_POST_PROCESS_SETTINGS).toEqual({
      enabled: true,
      opacity: 1,
      exposure: 1,
      contrast: 1.04,
      saturation: 1.05,
      vignette: 0,
      debugMode: "output",
      toneMapping: "aces",
      bloomEnabled: true,
      bloomThreshold: 0.85,
      bloomStrength: 0.18,
      bloomRadius: 0.35,
      godRaysMode: "off",
      godRaysDensity: 0.96,
      godRaysDecay: 0.92,
      godRaysWeight: 0.35,
      godRaysExposure: 0.6,
    });
  });

  it("parses bloom and tone-mapping overrides from YAML", () => {
    expect(parsePostProcessSettings(`
postprocess:
  enabled: false
  tone_mapping: agx
  bloom:
    enabled: false
    threshold: 1.1
    strength: 0.4
    radius: 0.6
`)).toMatchObject({
      enabled: false,
      toneMapping: "agx",
      bloomEnabled: false,
      bloomThreshold: 1.1,
      bloomStrength: 0.4,
      bloomRadius: 0.6,
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
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uBloomThreshold");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("bloomColor");
  });
});
