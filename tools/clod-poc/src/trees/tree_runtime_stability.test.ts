import { describe, expect, it } from "vitest";
import { cloneTreeSettings } from "./tree_config_defaults.js";
import { stabilizeRuntimeTreeSettings } from "./tree_runtime_stability.js";

describe("runtime tree stability", () => {
  it("keeps all distance rings and configured impostor baking while disabling temporal transitions", () => {
    const input = cloneTreeSettings();
    input.gpu.terrainVisibility.enabled = true;
    input.impostors.enabled = true;
    input.impostors.bakeOnStart = true;
    input.impostors.swapOnBake = true;
    input.lod.crossfadeEnabled = true;
    input.lod.crossfadeBandM = 20;
    input.lod.ditherEnabled = true;

    const settings = stabilizeRuntimeTreeSettings(input);

    expect(settings.distanceM).toBe(input.distanceM);
    expect(settings.impostors.enabled).toBe(true);
    expect(settings.gpu.terrainVisibility.enabled).toBe(false);
    expect(settings.impostors.bakeOnStart).toBe(true);
    expect(settings.impostors.swapOnBake).toBe(true);
    expect(settings.impostors.fallbackToPlaceholder).toBe(false);
    expect(settings.lod.crossfadeEnabled).toBe(false);
    expect(settings.lod.crossfadeBandM).toBe(0);
    expect(settings.lod.ditherEnabled).toBe(false);
  });
});
