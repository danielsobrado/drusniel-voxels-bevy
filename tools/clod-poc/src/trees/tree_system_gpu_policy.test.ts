import { describe, expect, it } from "vitest";
import { cloneTreeSettings } from "./tree_config_defaults.js";
import { treeCpuPatchCrossfadeEnabled, treeCpuPatchesAreGpuFallback } from "./tree_system_gpu_policy.js";

describe("tree GPU/CPU path policy", () => {
  it("keeps CPU crossfade for intentionally CPU-only tree mode", () => {
    const settings = cloneTreeSettings();
    settings.gpu.enabled = false;
    settings.lod.crossfadeEnabled = true;
    settings.lod.ditherEnabled = true;

    expect(treeCpuPatchesAreGpuFallback(settings)).toBe(false);
    expect(treeCpuPatchCrossfadeEnabled(settings)).toBe(true);
  });

  it("keeps CPU crossfade for GPU fallback patches so transitions stay stable", () => {
    const settings = cloneTreeSettings();
    settings.gpu.enabled = true;
    settings.gpu.fallbackToCpu = true;
    settings.lod.crossfadeEnabled = true;
    settings.lod.ditherEnabled = true;
    settings.lod.crossfadeBandM = 28;

    expect(treeCpuPatchesAreGpuFallback(settings)).toBe(true);
    expect(treeCpuPatchCrossfadeEnabled(settings)).toBe(true);
  });

  it("disables CPU crossfade when the configured band is zero", () => {
    const settings = cloneTreeSettings();
    settings.lod.crossfadeEnabled = true;
    settings.lod.ditherEnabled = true;
    settings.lod.crossfadeBandM = 0;

    expect(treeCpuPatchCrossfadeEnabled(settings)).toBe(false);
  });
});
