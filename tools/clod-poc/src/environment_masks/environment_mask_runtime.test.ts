import { afterEach, describe, expect, it } from "vitest";
import { cloneEnvironmentalMaskSettings } from "./environment_mask_config.js";
import {
  readEnvironmentalMaskSettings,
  setEnvironmentalMaskSettings,
} from "./environment_mask_runtime.js";

afterEach(() => setEnvironmentalMaskSettings(cloneEnvironmentalMaskSettings()));

describe("environmental mask runtime", () => {
  it("copies assigned settings so callers cannot mutate runtime ownership", () => {
    const input = cloneEnvironmentalMaskSettings();
    input.riverCobble.maxDepthM = 2;
    setEnvironmentalMaskSettings(input);
    input.riverCobble.maxDepthM = 9;

    expect(readEnvironmentalMaskSettings().riverCobble.maxDepthM).toBe(2);
  });

  it("replaces the complete settings snapshot", () => {
    const first = cloneEnvironmentalMaskSettings();
    first.enabled = false;
    setEnvironmentalMaskSettings(first);
    expect(readEnvironmentalMaskSettings().enabled).toBe(false);

    const second = cloneEnvironmentalMaskSettings();
    setEnvironmentalMaskSettings(second);
    expect(readEnvironmentalMaskSettings().enabled).toBe(true);
  });
});
