import { describe, expect, it } from "vitest";
import { DEFAULT_WATER_VISUAL } from "./water_config_defaults.js";
import { applyWaterEffectsState, createWaterEffectsRuntime } from "./water_effects_runtime.js";

describe("water effects runtime", () => {
  it("initializes from resolved settings", () => {
    const runtime = createWaterEffectsRuntime(DEFAULT_WATER_VISUAL, true);
    expect(runtime.current()).toEqual({
      glacialMurkiness: DEFAULT_WATER_VISUAL.glacialMurkiness.enabled,
      rockFlour: true,
      reflectionTiers: DEFAULT_WATER_VISUAL.reflection.clipmapTiers.enabled,
    });
  });

  it("keeps exact visual identity while unchanged", () => {
    const runtime = createWaterEffectsRuntime(DEFAULT_WATER_VISUAL);
    expect(runtime.apply(DEFAULT_WATER_VISUAL)).toBe(DEFAULT_WATER_VISUAL);
    expect(runtime.setEnabled("rockFlour", DEFAULT_WATER_VISUAL.rockFlour.enabled)).toBe(false);
  });

  it("clones only changed effect configuration", () => {
    const resolved = applyWaterEffectsState(DEFAULT_WATER_VISUAL, {
      glacialMurkiness: !DEFAULT_WATER_VISUAL.glacialMurkiness.enabled,
      rockFlour: DEFAULT_WATER_VISUAL.rockFlour.enabled,
      reflectionTiers: DEFAULT_WATER_VISUAL.reflection.clipmapTiers.enabled,
    });
    expect(resolved.glacialMurkiness).not.toBe(DEFAULT_WATER_VISUAL.glacialMurkiness);
    expect(resolved.rockFlour).toBe(DEFAULT_WATER_VISUAL.rockFlour);
    expect(resolved.reflection).toBe(DEFAULT_WATER_VISUAL.reflection);
  });
});
