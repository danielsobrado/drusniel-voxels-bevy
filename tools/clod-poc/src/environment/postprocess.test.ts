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
      renderScale: 0.75,
      exposure: 1,
      contrast: 1.05,
      saturation: 1.04,
      vignette: 0.08,
      debugMode: "output",
      toneMapping: "agx",
      bloomEnabled: true,
      bloomThreshold: 0.48,
      bloomStrength: 0.26,
      bloomRadius: 0.9,
      fxaaEnabled: true,
      fxaaEdgeThreshold: 0.125,
      fxaaSubpixelBlend: 0.75,
      taaEnabled: false,
      taaHistoryWeight: 0.88,
      taaDepthThreshold: 0.0025,
      taaSharpen: 0.06,
      taaJitterEnabled: false,
      taaJitterScale: 1,
      taaHistoryClampEnabled: false,
      taaHistoryClampStrength: 1,
      contactShadowsEnabled: true,
      contactShadowsStrength: 0.3,
      contactShadowsRadiusPx: 1.7,
      contactShadowsDepthBias: 0.002,
      clarityEnabled: true,
      claritySharpen: 0.06,
      clarityDither: 0.002,
      aerialPerspectiveEnabled: true,
      aerialPerspectiveStart: 260,
      aerialPerspectiveEnd: 2600,
      aerialPerspectiveStrength: 0.5,
      aerialPerspectiveColor: [0.62, 0.72, 0.86],
      cloudsEnabled: false,
      gtaoEnabled: false,
      froxelsEnabled: true,
      bounceEnabled: false,
      godRaysMode: "volumetric",
      godRaysDensity: 0.96,
      godRaysDecay: 0.92,
      godRaysWeight: 0.35,
      godRaysExposure: 0.6,
    });
  });

  it("parses bloom, FXAA, TAA, contact shadows, clarity, WebGPU stages, and tone-mapping overrides from YAML", () => {
    expect(parsePostProcessSettings(`
postprocess:
  enabled: false
  opacity: 0.9
  render_scale: 0.75
  tone_mapping: agx
  bloom:
    enabled: false
    threshold: 1.1
    strength: 0.4
    radius: 0.6
  fxaa:
    enabled: false
    edge_threshold: 0.2
    subpixel_blend: 0.5
  taa:
    enabled: true
    history_weight: 0.75
    depth_threshold: 0.01
    sharpen: 0.12
    jitter_enabled: false
    jitter_scale: 1.5
    history_clamp_enabled: false
    history_clamp_strength: 0.25
  contact_shadows:
    enabled: true
    strength: 0.5
    radius_px: 3.5
    depth_bias: 0.004
  clarity:
    enabled: false
    sharpen: 0.2
    dither: 0.01
  webgpu:
    clouds_enabled: false
    gtao_enabled: false
    froxels_enabled: false
    bounce_enabled: false
`)).toMatchObject({
      enabled: false,
      opacity: 0.9,
      renderScale: 0.75,
      toneMapping: "agx",
      bloomEnabled: false,
      bloomThreshold: 1.1,
      bloomStrength: 0.4,
      bloomRadius: 0.6,
      fxaaEnabled: false,
      fxaaEdgeThreshold: 0.2,
      fxaaSubpixelBlend: 0.5,
      taaEnabled: true,
      taaHistoryWeight: 0.75,
      taaDepthThreshold: 0.01,
      taaSharpen: 0.12,
      taaJitterEnabled: false,
      taaJitterScale: 1.5,
      taaHistoryClampEnabled: false,
      taaHistoryClampStrength: 0.25,
      contactShadowsEnabled: true,
      contactShadowsStrength: 0.5,
      contactShadowsRadiusPx: 3.5,
      contactShadowsDepthBias: 0.004,
      clarityEnabled: false,
      claritySharpen: 0.2,
      clarityDither: 0.01,
      cloudsEnabled: false,
      gtaoEnabled: false,
      froxelsEnabled: false,
      bounceEnabled: false,
    });
  });

  it("clamps render scale overrides to the safe range", () => {
    expect(parsePostProcessSettings("postprocess:\n  render_scale: 0.1\n").renderScale).toBe(0.5);
    expect(parsePostProcessSettings("postprocess:\n  render_scale: 2\n").renderScale).toBe(1);
    expect(applyPostProcessQueryOverrides(DEFAULT_POST_PROCESS_SETTINGS, new URLSearchParams("renderScale=0.2")).renderScale)
      .toBe(0.5);
    expect(applyPostProcessQueryOverrides(DEFAULT_POST_PROCESS_SETTINGS, new URLSearchParams("postScale=1.4")).renderScale)
      .toBe(1);
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
    const params = new URLSearchParams("renderScale=0.75&postmin=1&bloom=0&fxaa=1&taa=1&taaJitter=1&taaClamp=1&contactShadows=1&clarity=1&grade=0&toneMap=agx&clouds=1&gtao=1&froxels=1&bounce=1");
    expect(applyPostProcessQueryOverrides({
      ...DEFAULT_POST_PROCESS_SETTINGS,
      exposure: 1.8,
      contrast: 1.4,
      saturation: 0.5,
      vignette: 0.7,
      bloomEnabled: true,
      fxaaEnabled: false,
      taaEnabled: true,
      taaJitterEnabled: false,
      taaHistoryClampEnabled: false,
      contactShadowsEnabled: true,
      clarityEnabled: false,
      aerialPerspectiveEnabled: true,
      cloudsEnabled: true,
      gtaoEnabled: true,
      froxelsEnabled: true,
      bounceEnabled: true,
    }, params)).toMatchObject({
      enabled: true,
      renderScale: 0.75,
      exposure: 1,
      contrast: 1,
      saturation: 1,
      vignette: 0,
      bloomEnabled: false,
      fxaaEnabled: true,
      taaEnabled: true,
      taaJitterEnabled: true,
      taaHistoryClampEnabled: true,
      contactShadowsEnabled: true,
      clarityEnabled: true,
      aerialPerspectiveEnabled: false,
      cloudsEnabled: true,
      gtaoEnabled: true,
      froxelsEnabled: true,
      bounceEnabled: true,
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
        fxaaEnabled: false,
        taaEnabled: false,
        taaJitterEnabled: false,
        taaHistoryClampEnabled: false,
        contactShadowsEnabled: false,
        clarityEnabled: false,
        aerialPerspectiveEnabled: false,
        cloudsEnabled: false,
        gtaoEnabled: false,
        froxelsEnabled: false,
        bounceEnabled: false,
        godRaysMode: "off",
      });
  });

  it("uses depth-aware volumetrics as the default forest shaft path", () => {
    expect(DEFAULT_POST_PROCESS_SETTINGS.godRaysMode).toBe("volumetric");
    expect(DEFAULT_POST_PROCESS_SETTINGS.bloomEnabled).toBe(true);
    expect(DEFAULT_POST_PROCESS_SETTINGS.contactShadowsEnabled).toBe(true);
    expect(DEFAULT_POST_PROCESS_SETTINGS.froxelsEnabled).toBe(true);
    expect(DEFAULT_POST_PROCESS_SETTINGS.taaEnabled).toBe(false);
    expect(DEFAULT_POST_PROCESS_SETTINGS.cloudsEnabled).toBe(false);
    expect(DEFAULT_POST_PROCESS_SETTINGS.gtaoEnabled).toBe(false);
    expect(DEFAULT_POST_PROCESS_SETTINGS.bounceEnabled).toBe(false);
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
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uFxaaEdgeThreshold");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("fxaaSceneColor");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uTaaHistoryWeight");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uTaaHistoryClampStrength");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("historyClampColor");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("temporalSceneColor");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uContactShadowsStrength");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("contactShadowFactor");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uClaritySharpen");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("clarityOutput");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("interleavedNoise");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uExposure");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uContrast");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uSaturation");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uVignette");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uBloomThreshold");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uBloomEnabled < 0.5");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("bloomColor");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("uAerialPerspectiveEnabled < 0.5");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("aerialPerspective");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("tSunVisibilityAtlas");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("sunVisibilityAtWorld");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain("godRaysColor");
    expect(POSTPROCESS_SHADER_TEST_HOOKS.outputFragment).toContain(`i < ${GOD_RAYS_SCREEN_SAMPLES.heavy}`);
  });
});
