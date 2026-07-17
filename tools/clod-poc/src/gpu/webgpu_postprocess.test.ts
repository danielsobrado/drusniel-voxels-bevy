import { describe, expect, it } from "vitest";
import {
  DEFAULT_POST_PROCESS_SETTINGS,
  type PostProcessSettings,
} from "../environment/postprocess.js";
import { parsePostFxStageFlags, type PostFxStageFlags } from "./postfx_stage_flags.js";
import {
  WebGpuPostProcessPipeline,
  postProcessOutputGraphDirty,
} from "./webgpu_postprocess.js";

interface StageInspectablePipeline {
  settings: Required<PostProcessSettings>;
  stageFlags: PostFxStageFlags;
  bounceEnabled: boolean;
  cloudsEnabled: boolean;
  froxelsEnabled: boolean;
  gtaoEnabled: boolean;
  syncStageSettings(): void;
  effectiveFroxelsEnabled(): boolean;
}

function stageInspectablePipeline(
  settings: Partial<PostProcessSettings>,
  search = "",
): StageInspectablePipeline {
  const pipeline = Object.create(WebGpuPostProcessPipeline.prototype) as StageInspectablePipeline;
  pipeline.settings = { ...DEFAULT_POST_PROCESS_SETTINGS, ...settings };
  pipeline.stageFlags = parsePostFxStageFlags(search);
  pipeline.bounceEnabled = false;
  pipeline.cloudsEnabled = false;
  pipeline.froxelsEnabled = false;
  pipeline.gtaoEnabled = false;
  return pipeline;
}

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

describe("WebGpuPostProcessPipeline stage resolution", () => {
  it("reads stage activation from live settings and respects ablation", () => {
    const pipeline = stageInspectablePipeline({
      bounceEnabled: true,
      cloudsEnabled: true,
      froxelsEnabled: true,
      gtaoEnabled: true,
    });
    pipeline.syncStageSettings();
    expect(pipeline).toMatchObject({
      bounceEnabled: true,
      cloudsEnabled: true,
      froxelsEnabled: true,
      gtaoEnabled: true,
    });

    const ablated = stageInspectablePipeline({
      bounceEnabled: true,
      cloudsEnabled: true,
      froxelsEnabled: true,
      gtaoEnabled: true,
    }, "?ablate=clouds,froxels");
    ablated.syncStageSettings();
    expect(ablated).toMatchObject({
      bounceEnabled: true,
      cloudsEnabled: false,
      froxelsEnabled: false,
      gtaoEnabled: true,
    });
  });

  it("forces froxel ambience only for an allowed volumetric god-rays stage", () => {
    const volumetric = stageInspectablePipeline({
      froxelsEnabled: false,
      godRaysMode: "volumetric",
    });
    volumetric.syncStageSettings();
    expect(volumetric.effectiveFroxelsEnabled()).toBe(true);

    const heavy = stageInspectablePipeline({
      froxelsEnabled: false,
      godRaysMode: "heavy",
    });
    heavy.syncStageSettings();
    expect(heavy.effectiveFroxelsEnabled()).toBe(false);

    const ablatedFroxels = stageInspectablePipeline({
      froxelsEnabled: false,
      godRaysMode: "volumetric",
    }, "?ablate=froxels");
    ablatedFroxels.syncStageSettings();
    expect(ablatedFroxels.effectiveFroxelsEnabled()).toBe(false);

    const ablatedGodRays = stageInspectablePipeline({
      froxelsEnabled: false,
      godRaysMode: "volumetric",
    }, "?ablate=godrays");
    ablatedGodRays.syncStageSettings();
    expect(ablatedGodRays.effectiveFroxelsEnabled()).toBe(false);
  });
});
