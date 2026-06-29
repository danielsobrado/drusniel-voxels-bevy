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

  it("provides default material vectors for expanded species", () => {
    const settings = cloneTreeSettings(DEFAULT_TREE_SETTINGS);

    expect(treeSpeciesMaterialVector(settings, "birch")).toEqual([1.12, 0.42, 0.82, 0.18]);
    expect(treeSpeciesMaterialVector(settings, "willow")).toEqual([1.04, 0.22, 1.16, 0.02]);
    expect(treeSpeciesMaterialVector(settings, "spruce")).toEqual([0.72, 1.12, 0.28, 0.86]);
  });

  it("parses six-species material bias YAML without affecting live species union", () => {
    const settings = applyTreeMaterialBiasFromYaml(cloneTreeSettings(DEFAULT_TREE_SETTINGS), `
trees:
  ecology:
    material_bias:
      grass:
        birch: 1.4
        willow: 1.2
        spruce: 0.7
      rock:
        birch: 0.2
        willow: 0.1
        spruce: 1.6
      sand:
        birch: 0.8
        willow: 1.8
        spruce: 0.2
      snow:
        birch: 0.3
        willow: 0.0
        spruce: 1.1
`, null);

    expect(treeSpeciesMaterialVector(settings, "birch")).toEqual([1.4, 0.2, 0.8, 0.3]);
    expect(treeSpeciesMaterialVector(settings, "willow")).toEqual([1.2, 0.1, 1.8, 0]);
    expect(treeSpeciesMaterialVector(settings, "spruce")).toEqual([0.7, 1.6, 0.2, 1.1]);
    expect(treeSpeciesMaterialVector(settings, "oak")[0]).toBe(1.22);
  });

  it("blends expanded species material bias using terrain weights", () => {
    const settings = cloneTreeSettings(DEFAULT_TREE_SETTINGS);
    const spruce = treeSpeciesMaterialBias(settings, "spruce", [0.25, 0.5, 0, 0.25]);

    expect(spruce).toBeCloseTo(0.25 * 0.72 + 0.5 * 1.12 + 0.25 * 0.86, 5);
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
    expect(treeSpeciesMaterialVector(settings, "spruce")).toEqual([0.72, 1.12, 0.28, 0.86]);
  });
});
