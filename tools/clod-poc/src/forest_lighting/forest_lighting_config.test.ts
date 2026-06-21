import { describe, expect, it, vi } from "vitest";
import forestLightingYaml from "../../config/forest_lighting.yaml?raw";
import {
  cloneForestLightingSettings,
  createForestLightingIntegrationWarner,
  DEFAULT_FOREST_LIGHTING_SETTINGS,
  FOREST_LIGHTING_TERRAIN_INTEGRATION_WARNING,
  parseForestLightingConfig,
} from "./index.js";

describe("forest lighting config", () => {
  it("parses config/forest_lighting.yaml to defaults", () => {
    expect(parseForestLightingConfig(forestLightingYaml, null)).toEqual(DEFAULT_FOREST_LIGHTING_SETTINGS);
  });

  it("keeps terrain material integration disabled by default", () => {
    expect(DEFAULT_FOREST_LIGHTING_SETTINGS.materialIntegration.terrainEnabled).toBe(false);
    expect(parseForestLightingConfig(forestLightingYaml, null).materialIntegration.terrainEnabled).toBe(false);
  });

  it("still parses explicit terrain material integration for future support", () => {
    const parsed = parseForestLightingConfig(`
forest_lighting:
  material_integration:
    terrain_enabled: true
`, null);
    expect(parsed.materialIntegration.terrainEnabled).toBe(true);
  });

  it("uses defaults for missing config", () => {
    expect(parseForestLightingConfig("", null)).toEqual(DEFAULT_FOREST_LIGHTING_SETTINGS);
  });

  it("clamps invalid numeric values and falls back for invalid debug mode", () => {
    const parsed = parseForestLightingConfig(`
forest_lighting:
  field:
    resolution: 4096
    update_distance_m: -4
  ambient_occlusion:
    strength: 3
  shadow_proxy:
    strength: -1
  atmosphere:
    forest_fog_strength: 2
  material_integration:
    debug_mode: invalid
`, null);
    expect(parsed.field.resolution).toBe(512);
    expect(parsed.field.updateDistanceM).toBe(0);
    expect(parsed.ambientOcclusion.strength).toBe(1);
    expect(parsed.shadowProxy.strength).toBe(0);
    expect(parsed.atmosphere.forestFogStrength).toBe(1);
    expect(parsed.materialIntegration.debugMode).toBe(DEFAULT_FOREST_LIGHTING_SETTINGS.materialIntegration.debugMode);
  });

  it("deep-clones nested objects", () => {
    const cloned = cloneForestLightingSettings();
    cloned.field.resolution = 64;
    cloned.materialIntegration.debugMode = "ao";
    expect(DEFAULT_FOREST_LIGHTING_SETTINGS.field.resolution).toBe(128);
    expect(DEFAULT_FOREST_LIGHTING_SETTINGS.materialIntegration.debugMode).toBe("off");
  });

  it("warns once when terrain integration is configured before implementation exists", () => {
    const warn = vi.fn();
    const warnUnsupportedIntegration = createForestLightingIntegrationWarner(warn);
    const settings = cloneForestLightingSettings();
    settings.materialIntegration.terrainEnabled = true;

    warnUnsupportedIntegration(settings);
    warnUnsupportedIntegration(settings);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(FOREST_LIGHTING_TERRAIN_INTEGRATION_WARNING);
  });

  it("does not warn when terrain integration stays disabled", () => {
    const warn = vi.fn();
    const warnUnsupportedIntegration = createForestLightingIntegrationWarner(warn);
    warnUnsupportedIntegration(cloneForestLightingSettings());
    expect(warn).not.toHaveBeenCalled();
  });
});
