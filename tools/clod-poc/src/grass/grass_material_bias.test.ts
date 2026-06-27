import { describe, expect, it } from "vitest";
import { cloneGrassSettings, DEFAULT_GRASS_SETTINGS } from "./grass_config.js";
import {
  applyGrassMaterialBiasFromYaml,
  grassHeightDensityVector,
  grassMaterialDensityVector,
  grassTerrainDensity,
} from "./grass_material_bias.js";

describe("grass material bias", () => {
  it("reads material and height density from YAML", () => {
    const settings = applyGrassMaterialBiasFromYaml(cloneGrassSettings(DEFAULT_GRASS_SETTINGS), `
grass:
  terrain:
    grass:
      density: 1.25
    rock:
      density: 0.40
    sand:
      density: 0.70
    snow:
      density: 0.05
    height:
      low_height_m: 10
      high_height_m: 30
      height_blend_m: 5
      low:
        density: 1.10
      mid:
        density: 0.90
      high:
        density: 0.35
`, null);

    expect(grassMaterialDensityVector(settings)).toEqual([1.25, 0.40, 0.70, 0.05]);
    expect(grassHeightDensityVector(settings)).toEqual([10, 30, 5, 1.10, 0.90, 0.35]);
    expect(grassTerrainDensity(settings, [0, 1, 0, 0], 20)).toBeCloseTo(0.36);
  });

  it("falls back to defaults when the YAML is malformed", () => {
    const warnings: string[] = [];
    const settings = applyGrassMaterialBiasFromYaml(
      cloneGrassSettings(DEFAULT_GRASS_SETTINGS),
      "grass:\n  terrain: [",
      (message) => warnings.push(message),
    );

    expect(warnings).toHaveLength(1);
    expect(grassMaterialDensityVector(settings)).toEqual([1.12, 0.18, 0.58, 0.02]);
  });
});
