import { afterEach, describe, expect, it } from "vitest";
import { cloneEnvironmentalMaskSettings } from "../environment_masks/environment_mask_config.js";
import { setEnvironmentalMaskSettings } from "../environment_masks/environment_mask_runtime.js";
import { riverCobbleGpuEnabled } from "./river_cobble_runtime.js";

afterEach(() => setEnvironmentalMaskSettings(cloneEnvironmentalMaskSettings()));

describe("river cobble runtime flag", () => {
  it("is disabled by default", () => {
    expect(riverCobbleGpuEnabled("")).toBe(false);
  });

  it("accepts primary and alias enable flags", () => {
    expect(riverCobbleGpuEnabled("?riverCobbles=1")).toBe(true);
    expect(riverCobbleGpuEnabled("?underwaterCobbles=true")).toBe(true);
    expect(riverCobbleGpuEnabled("?stoneRiverCobbles")).toBe(true);
  });

  it("honors explicit disable values", () => {
    expect(riverCobbleGpuEnabled("?riverCobbles=0")).toBe(false);
    expect(riverCobbleGpuEnabled("?riverCobbles=off")).toBe(false);
  });

  it("fails closed when YAML disables the shared layer or cobble mask", () => {
    const settings = cloneEnvironmentalMaskSettings();
    settings.riverCobble.enabled = false;
    setEnvironmentalMaskSettings(settings);
    expect(riverCobbleGpuEnabled("?riverCobbles=1")).toBe(false);

    settings.enabled = false;
    settings.riverCobble.enabled = true;
    setEnvironmentalMaskSettings(settings);
    expect(riverCobbleGpuEnabled("?riverCobbles=1")).toBe(false);
  });
});
