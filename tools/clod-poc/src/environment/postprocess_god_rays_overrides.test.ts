import { describe, expect, it } from "vitest";
import { applyEnvironmentQueryOverrides } from "../app/state/environment_query_overrides.js";
import {
  DEFAULT_POST_PROCESS_SETTINGS,
  applyPostProcessQueryOverrides,
  parsePostProcessSettings,
} from "./postprocess.js";

function debugAppState() {
  return {
    postProcessEnabled: true,
    postProcessDebugMode: "output",
    postProcessBloomEnabled: true,
    postProcessFxaaEnabled: true,
    postProcessTaaEnabled: true,
    postProcessTaaJitterEnabled: true,
    postProcessTaaHistoryClampEnabled: true,
    postProcessContactShadowsEnabled: true,
    postProcessClarityEnabled: true,
    postProcessAerialPerspectiveEnabled: true,
    postProcessCloudsEnabled: true,
    postProcessGtaoEnabled: true,
    postProcessFroxelsEnabled: true,
    postProcessBounceEnabled: true,
    godRaysMode: "volumetric",
    hazeIntensity: 0.5,
    froxelDebugEnabled: false,
    froxelDebugMode: "off",
  };
}

describe("god-rays dust settings", () => {
  it("applies all shared query controls and aliases", () => {
    expect(applyPostProcessQueryOverrides(
      DEFAULT_POST_PROCESS_SETTINGS,
      new URLSearchParams({
        godRaysDustStrength: "0.75",
        godRaysDustScale: "12.5",
        godRaysDustSpeed: "0.2",
      }),
    )).toMatchObject({
      godRaysDustStrength: 0.75,
      godRaysDustScale: 12.5,
      godRaysDustSpeed: 0.2,
    });

    expect(applyPostProcessQueryOverrides(
      DEFAULT_POST_PROCESS_SETTINGS,
      new URLSearchParams({
        godraysdust: "0.25",
        godraysdustscale: "4",
        godraysdustspeed: "0.1",
      }),
    )).toMatchObject({
      godRaysDustStrength: 0.25,
      godRaysDustScale: 4,
      godRaysDustSpeed: 0.1,
    });
  });

  it("clamps finite query values and ignores invalid values", () => {
    const clamped = applyPostProcessQueryOverrides(
      DEFAULT_POST_PROCESS_SETTINGS,
      new URLSearchParams({
        godRaysDust: "2",
        godRaysDustScale: "100",
        godRaysDustSpeed: "-1",
      }),
    );
    expect(clamped).toMatchObject({
      godRaysDustStrength: 1,
      godRaysDustScale: 24,
      godRaysDustSpeed: 0,
    });

    expect(applyPostProcessQueryOverrides(
      clamped,
      new URLSearchParams({
        godRaysDust: "bad",
        godRaysDustScale: "Infinity",
        godRaysDustSpeed: "NaN",
      }),
    )).toMatchObject({
      godRaysDustStrength: 1,
      godRaysDustScale: 24,
      godRaysDustSpeed: 0,
    });
  });

  it("clamps YAML dust settings to GUI-supported ranges", () => {
    expect(parsePostProcessSettings(`
postprocess:
  god_rays:
    dust_strength: 3
    dust_scale: 100
    dust_speed: -2
`)).toMatchObject({
      godRaysDustStrength: 1,
      godRaysDustScale: 24,
      godRaysDustSpeed: 0,
    });
  });

  it("turns god rays off with the shared fog-disable flag", () => {
    expect(applyPostProcessQueryOverrides(
      DEFAULT_POST_PROCESS_SETTINGS,
      new URLSearchParams({ fog: "0" }),
    )).toMatchObject({
      aerialPerspectiveEnabled: false,
      godRaysMode: "off",
    });
  });
});

describe("froxel debug reachability", () => {
  it("re-enables the shared output pipeline after fx=0", () => {
    expect(applyPostProcessQueryOverrides(
      DEFAULT_POST_PROCESS_SETTINGS,
      new URLSearchParams({ fx: "0", froxelDebug: "density" }),
    )).toMatchObject({
      enabled: true,
      debugMode: "output",
      froxelsEnabled: false,
      froxelDebugEnabled: true,
      froxelDebugMode: "density",
    });
  });

  it("re-enables the app output pipeline after fx=0", () => {
    const state = debugAppState();
    applyEnvironmentQueryOverrides(
      state as never,
      new URLSearchParams({ fx: "0", froxelDebug: "density" }),
    );

    expect(state).toMatchObject({
      postProcessEnabled: true,
      postProcessDebugMode: "output",
      postProcessFroxelsEnabled: false,
      froxelDebugEnabled: true,
      froxelDebugMode: "density",
    });
  });
});
