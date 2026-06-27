import { describe, expect, it } from "vitest";
import { cloneTreeSettings, DEFAULT_TREE_SETTINGS } from "./tree_config.js";
import {
  applyTreeMaterialBiasFromYaml,
  treeMaterialDensity,
  treeMaterialDensityVector,
  treeSpeciesMaterialBias,
  treeSpeciesMaterialVector,
} from "./tree_material_bias.js";

describe("tree material bias", () => {
  it("reads density and species weights from YAML", () => {
    const settings = applyTreeMaterialBiasFromYaml(cloneTreeSettings(DEFAULT_TREE_SETTINGS), `
trees:
  ecology:
    material_bias:
      grass:
        density: 1.20
        oak: 1.50
        pine: 0.80
        dead: 0.40
      rock:
        density: 0.30
        oak: 0.20
        pine: 1.10
        dead: 1.70
      sand:
        density: 0.60
        oak: 0.70
        pine: 0.50
        dead: 0.90
      snow:
        density: 0.05
        oak: 0.03
        pine: 0.25
        dead: 1.30
`, null);

    expect(treeMaterialDensityVector(settings)).toEqual([1.20, 0.30, 0.60, 0.05]);
    expect(treeSpeciesMaterialVector(settings, "oak")).toEqual([1.50, 0.20, 0.70, 0.03]);
    expect(treeMaterialDensity(settings, [0, 1, 0, 0])).toBeCloseTo(0.30);
    expect(treeSpeciesMaterialBias(settings, "dead", [0, 1, 0, 0])).toBeCloseTo(1.70);
  });

  it("falls back to defaults when the YAML is malformed", () => {
    const warnings: string[] = [];
    const settings = applyTreeMaterialBiasFromYaml(
      cloneTreeSettings(DEFAULT_TREE_SETTINGS),
      "trees:\n  ecology:\n    material_bias: [",
      (message) => warnings.push(message),
    );

    expect(warnings).toHaveLength(1);
    expect(treeMaterialDensityVector(settings)).toEqual([1.08, 0.46, 0.55, 0.08]);
  });
});
