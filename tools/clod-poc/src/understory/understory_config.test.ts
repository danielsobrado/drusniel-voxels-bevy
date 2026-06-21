import { describe, expect, it } from "vitest";
import configText from "../../config/understory.yaml?raw";
import {
  cloneUnderstorySettings,
  DEFAULT_UNDERSTORY_SETTINGS,
  parseUnderstoryConfig,
} from "./understory_config.js";

describe("understory config", () => {
  it("parses config/understory.yaml to the typed defaults", () => {
    expect(parseUnderstoryConfig(configText, null)).toEqual(DEFAULT_UNDERSTORY_SETTINGS);
  });

  it("uses defaults for missing config", () => {
    expect(parseUnderstoryConfig(undefined, null)).toEqual(DEFAULT_UNDERSTORY_SETTINGS);
  });

  it("clamps unsafe values and corrects max scale below min scale", () => {
    const cfg = parseUnderstoryConfig(`
understory:
  distance_m: -5
  refresh_distance_m: 0
  max_new_patches_per_frame: -3
  max_instances: -20
  placement:
    spacing_m: -1
    slope_min_y: 2
    min_ground_weight: -1
  classes:
    shrub:
      weight: -3
      density: -2
      min_scale: 2
      max_scale: 1
      height_preference: sideways
`, null);

    expect(cfg.distanceM).toBe(0);
    expect(cfg.refreshDistanceM).toBeGreaterThan(0);
    expect(cfg.maxNewPatchesPerFrame).toBe(1);
    expect(cfg.maxInstances).toBe(0);
    expect(cfg.placement.spacingM).toBeGreaterThan(0);
    expect(cfg.placement.slopeMinY).toBe(1);
    expect(cfg.placement.minGroundWeight).toBe(0);
    expect(cfg.classes.shrub.weight).toBe(0);
    expect(cfg.classes.shrub.density).toBe(0);
    expect(cfg.classes.shrub.maxScale).toBe(cfg.classes.shrub.minScale);
    expect(cfg.classes.shrub.heightPreference).toBe(DEFAULT_UNDERSTORY_SETTINGS.classes.shrub.heightPreference);
  });

  it("deep-clones nested settings", () => {
    const clone = cloneUnderstorySettings();
    clone.classes.fern.weight = 99;
    clone.ecology.moistureStrength = 0;
    expect(DEFAULT_UNDERSTORY_SETTINGS.classes.fern.weight).not.toBe(99);
    expect(DEFAULT_UNDERSTORY_SETTINGS.ecology.moistureStrength).not.toBe(0);
  });
});
