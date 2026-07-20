import { describe, expect, it } from "vitest";
import farReflectionConfigText from "../../config/water_far_reflection.yaml?raw";
import { DEFAULT_WATER_VISUAL } from "./water_config_defaults.js";
import {
  parseWaterFarReflectionConfig,
  resolveWaterFarReflectionConfig,
  sanitizeWaterFarReflectionConfig,
} from "./water_far_reflection_config.js";

describe("water far reflection config", () => {
  it("parses the bundled production policy", () => {
    const parsed = parseWaterFarReflectionConfig(
      farReflectionConfigText,
      DEFAULT_WATER_VISUAL.reflection.farSummary,
    );
    expect(parsed).toMatchObject({
      enabled: false,
      sourceResolution: 65,
      sourceSpanM: 1024,
      sourceBuildCellsPerFrame: 512,
      maxSteps: 6,
      maxDistanceM: 320,
    });
  });

  it("keeps the march between five and eight steps and sanitizes invalid geometry", () => {
    expect(sanitizeWaterFarReflectionConfig({
      ...DEFAULT_WATER_VISUAL.reflection.farSummary,
      sourceResolution: 1,
      sourceSpanM: -1,
      sourceBuildCellsPerFrame: 0,
      maxSteps: 99,
      stepGrowth: 0.5,
      terrainStrength: 3,
      propStrength: -2,
    })).toMatchObject({
      sourceResolution: 2,
      sourceSpanM: 1024,
      sourceBuildCellsPerFrame: 1,
      maxSteps: 8,
      stepGrowth: 1.01,
      terrainStrength: 1,
      propStrength: 0,
    });
  });

  it("supports an explicit query gate without mutating the parsed policy", () => {
    const parsed = { ...DEFAULT_WATER_VISUAL.reflection.farSummary, enabled: false };
    const enabled = resolveWaterFarReflectionConfig(parsed, new URLSearchParams({ waterFarReflection: "1" }));
    expect(enabled.enabled).toBe(true);
    expect(parsed.enabled).toBe(false);
    expect(resolveWaterFarReflectionConfig(enabled, new URLSearchParams({ waterFarReflection: "0" })).enabled).toBe(false);
  });
});
