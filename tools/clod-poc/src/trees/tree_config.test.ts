import { describe, expect, it } from "vitest";
import { DEFAULT_TREE_SETTINGS, cloneTreeSettings, parseTreeSettings } from "./tree_config.js";

describe("tree config", () => {
  it("keeps normal GPU debug readbacks disabled by default", () => {
    expect(DEFAULT_TREE_SETTINGS.gpu.readbackVisibleLists).toBe(false);
    expect(DEFAULT_TREE_SETTINGS.gpu.debugShowGpuCounts).toBe(false);
    expect(DEFAULT_TREE_SETTINGS.gpu.debugValidateAgainstCpu).toBe(false);
  });

  it("parses explicit GPU debug readback overrides", () => {
    const settings = parseTreeSettings(`
trees:
  gpu:
    readback_visible_lists: true
    debug_show_gpu_counts: true
    debug_validate_against_cpu: true
`);

    expect(settings.gpu.readbackVisibleLists).toBe(true);
    expect(settings.gpu.debugShowGpuCounts).toBe(true);
    expect(settings.gpu.debugValidateAgainstCpu).toBe(true);
  });

  it("parses terrain visibility settings", () => {
    const settings = parseTreeSettings(`
trees:
  gpu:
    terrain_visibility:
      enabled: false
      min_distance_m: 144
      sample_count: 9
      height_margin_m: 2.5
      crown_height_m: 8
`);

    expect(settings.gpu.terrainVisibility).toEqual({
      enabled: false,
      minDistanceM: 144,
      sampleCount: 9,
      heightMarginM: 2.5,
      crownHeightM: 8,
    });
  });

  it("falls back and clamps terrain visibility values safely", () => {
    const settings = parseTreeSettings(`
trees:
  gpu:
    terrain_visibility:
      min_distance_m: -4
      sample_count: 99
      crown_height_m: -3
`);

    expect(settings.gpu.terrainVisibility.enabled).toBe(DEFAULT_TREE_SETTINGS.gpu.terrainVisibility.enabled);
    expect(settings.gpu.terrainVisibility.minDistanceM).toBe(0);
    expect(settings.gpu.terrainVisibility.sampleCount).toBe(16);
    expect(settings.gpu.terrainVisibility.heightMarginM).toBe(DEFAULT_TREE_SETTINGS.gpu.terrainVisibility.heightMarginM);
    expect(settings.gpu.terrainVisibility.crownHeightM).toBe(0);
  });

  it("deep clones terrain visibility settings", () => {
    const clone = cloneTreeSettings(DEFAULT_TREE_SETTINGS);
    clone.gpu.terrainVisibility.enabled = !DEFAULT_TREE_SETTINGS.gpu.terrainVisibility.enabled;
    clone.gpu.terrainVisibility.minDistanceM = DEFAULT_TREE_SETTINGS.gpu.terrainVisibility.minDistanceM + 10;

    expect(clone.gpu.terrainVisibility).not.toBe(DEFAULT_TREE_SETTINGS.gpu.terrainVisibility);
    expect(DEFAULT_TREE_SETTINGS.gpu.terrainVisibility.minDistanceM).not.toBe(clone.gpu.terrainVisibility.minDistanceM);
  });
});
