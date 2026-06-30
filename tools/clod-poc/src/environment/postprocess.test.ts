import { describe, expect, it } from "vitest";
import {
  DEFAULT_POST_PROCESS_SETTINGS,
  GOD_RAYS_SCREEN_SAMPLES,
  POSTPROCESS_SHADER_TEST_HOOKS,
  applyPostProcessQueryOverrides,
  parseAerialPerspectiveSettings,
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
      taaEnabled: false,
      taaHistoryWeight: 0.88,
      taaDepthThreshold: 0.0025,
      taaSharpen: 0.06,
      aerialPerspectiveEnabled: true,
      aerialPerspectiveStart: 120,
      aerialPerspectiveEnd: 1800,
      aerialPerspectiveStrength: 0.35,
      aerialPerspectiveColor: [0.62, 0.72, 0.86],
      godRaysMode: "off",
      godRaysDensity: 0.96,
      godRaysDecay: 0.92,
      godRaysWeight: 0.35,
      godRaysExposure: 0.6,
    });
  });

  it("parses bloom, TAA, and tone-mapping overrides from YAML", () => {
    expect(parsePostProcessSettings(`
postprocess:
  enabled: false
  tone_mapping: agx
  bloom:
    enabled: false
    threshold: 1.1
    strength: 0.4
    radius: 0.6
  taa:
    enabled: true
    history_weight: 0.75
    depth_threshold: 0.01
    sharpen: 0.12
`)).toMatchObject({
      enabled: false,
      toneMapping: "agx",
      bloomEnabled: false,
      bloomThreshold: 1.1,
      bloomStrength: 0.4,
      bloomRadius: 0.6,
      taaEnabled: true,
      taaHistoryWeight: 0.75,
      taaDepthThreshold: 0.01,
      taaSharpen: 0.12,
    });
  });

  it("parses aerial perspective YAML", () => {
    expect(parseAerialPerspectiveSettings(`
aerial_perspective:
  enabled: false
  start_m: 300
  end_m: 1200
  strength: 0.25
  color: [0.5, 0.6, 0.7]
`)).toEqual({
      aerialPerspectiveEnabled: false,
      aerialPerspectiveStart: 300,
      aerialPerspectiveEnd: 1200,
      aerialPerspectiveStrength: 0.25,
      aerialPerspectiveColor: [0.5, 0.6, 0.7],
    });
  });

  it("applies URL ablation overrides", () => {
    const params = new URLSearchParams("postmin=1&bloom=0&taa=1&grade=0&toneMap=agx");
    expect(applyPostProcessQueryOverrides({
      ...DEFAULT_POST_PROCESS_SETTINGS,
      exposure: 1.8,
      contrast: 1.4,
      saturation: 0.5,
      vignette: 0.7,
      bloomEnabled: true,
      taaEnabled: true,
      aerialPerspectiveEnabled: true,
    }, params)).toMatchObject({
      enabled: true,
      exposure: 1,
      contrast: 1,
      saturation: 1,
      vignette: 0,
      bloomEnabled: false,
      taaEnabled: true,
      aerialPerspectiveEnabled: false,
      godRaysMode: "off",
      toneMapping: "agx",
    });
  });

  it("lets fx=0 disable the post stack", () => {
    expect(applyPostProcessQueryOverrides(DEFAULT_POST_PROCESS_SETTINGS, new URLSearchParams("fx=0")))
      .toMatchObject({
        enabled: false,
        debugMode: "off",
        bloomEnabled: false,
        taaEnabled: false,
        aerialPerspectiveEnabled: false,
        godRaysMode: "off",
      });
  });

  it("defaults god rays and TAA off so existing scenes are unchanged", () => {
    expect(DEFAULT_POST_PROCESS_SETTINGS.godRaysMode).toBe("off");
    expect(DEFAULT_POST_PROCESS_SETTINGS.taaEnabled).toBe(false);
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
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("tDepth");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("tHistory");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("tHistoryDepth");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uPrevViewProjection");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uInvCurrentViewProjection");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uTaaHistoryWeight");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("temporalSceneColor");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uExposure");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uContrast");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uSaturation");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uVignette");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uBloomThreshold");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("bloomColor");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("aerialPerspective");
  });
});
