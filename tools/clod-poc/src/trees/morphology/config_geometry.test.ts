import { describe, expect, it } from "vitest";
import { parseTreeConfig } from "../tree_config_parsing.js";
import { DEFAULT_TREE_SETTINGS } from "../tree_config_defaults.js";
import { createTreeGeometryMap, disposeTreeGeometryMap } from "../tree_geometry.js";
import { TREE_LODS, TREE_SPECIES } from "../tree_config_types.js";

describe("tree runtime morphology integration", () => {
  it("parses the separate runtime morphology block", () => {
    const parsed = parseTreeConfig(`
trees:
  species:
    oak:
      morphology_runtime:
        slope_lean: 0.08
        wind_lean: 0.04
        random_lean: 0.05
        exposure_flattening: 0.05
        age_flattening: 0.08
        base_droop: 0.03
        age_droop: 0.12
        moisture_droop: 0.05
        base_stiffness: 0.90
`, null);
    expect(parsed.species.oak.morphologyRuntime).toEqual(DEFAULT_TREE_SETTINGS.species.oak.morphologyRuntime);
    expect(parsed.species.oak.morphology).toEqual(DEFAULT_TREE_SETTINGS.species.oak.morphology);
  });

  it("rejects unknown runtime morphology keys", () => {
    expect(() => parseTreeConfig(`
trees:
  species:
    oak:
      morphology_runtime:
        slope_lean: 0.08
        invented_value: 1
`, null)).toThrow(/invented_value/);
  });

  it("emits every required morphology attribute on every variant and LOD", () => {
    const map = createTreeGeometryMap(DEFAULT_TREE_SETTINGS);
    const required = ["treeHeight01", "treeRadial01", "treeBranchLevel", "treeBranchPhase", "treeRootMask"];
    try {
      for (const species of TREE_SPECIES) {
        for (const variant of Object.values(map[species].variants)) {
          for (const lod of TREE_LODS) {
            const geometry = variant[lod];
            const count = geometry.getAttribute("position").count;
            for (const name of required) expect(geometry.getAttribute(name)?.count, `${species}/${lod}/${name}`).toBe(count);
            if (species !== "dead" && lod !== "impostor") {
              expect(maxAttribute(geometry, "treeHeight01")).toBeGreaterThan(0.9);
              expect(maxAttribute(geometry, "treeBranchPhase")).toBeGreaterThan(0);
            }
          }
        }
      }
    } finally {
      disposeTreeGeometryMap(map);
    }
  }, 30000);
});

function maxAttribute(geometry: import("three").BufferGeometry, name: string): number {
  const attribute = geometry.getAttribute(name);
  let max = 0;
  for (let i = 0; i < attribute.count; i++) max = Math.max(max, attribute.getX(i));
  return max;
}
