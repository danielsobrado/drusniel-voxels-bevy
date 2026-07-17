import { describe, expect, it } from "vitest";
import {
  DEFAULT_POST_PROCESS_SETTINGS,
  applyPostProcessQueryOverrides,
  parsePostProcessSettings,
} from "./postprocess.js";

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
