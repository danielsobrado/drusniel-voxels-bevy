import { describe, expect, it } from "vitest";
import forestLightingYaml from "../../config/forest_lighting.yaml?raw";
import {
  cloneForestLightingSettings,
  DEFAULT_FOREST_LIGHTING_SETTINGS,
  parseForestLightingConfig,
} from "./index.js";

describe("forest lighting config", () => {
  it("parses config/forest_lighting.yaml to defaults", () => {
    expect(parseForestLightingConfig(forestLightingYaml, null)).toEqual(DEFAULT_FOREST_LIGHTING_SETTINGS);
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
});
