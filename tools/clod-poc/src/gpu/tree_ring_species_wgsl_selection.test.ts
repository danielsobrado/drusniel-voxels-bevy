import { describe, expect, it } from "vitest";
import treeRingShader from "./shaders/tree_ring.compute.wgsl?raw";
import { replaceTreeRingSpeciesSelection, treeRingSixSpeciesWgslSelectionSource } from "./tree_ring_species_wgsl_selection.js";

describe("TREE-9 six-species WGSL selection source", () => {
  it("contains material bias branches for all six species", () => {
    const source = treeRingSixSpeciesWgslSelectionSource();

    expect(source).toContain("params.species_material_oak");
    expect(source).toContain("params.species_material_pine");
    expect(source).toContain("params.species_material_dead");
    expect(source).toContain("params.species_material_birch");
    expect(source).toContain("params.species_material_willow");
    expect(source).toContain("params.species_material_spruce");
  });

  it("contains ecological weight terms for birch, willow, and spruce", () => {
    const source = treeRingSixSpeciesWgslSelectionSource();

    expect(source).toContain("let birch = base_a.w");
    expect(source).toContain("let willow = base_b.x");
    expect(source).toContain("let spruce = base_b.y");
    expect(source).toContain("mix(0.58, 1.72, moisture)");
    expect(source).toContain("materials.w * 0.36");
  });

  it("returns species indices 0 through 5", () => {
    const source = treeRingSixSpeciesWgslSelectionSource();

    for (const id of ["0u", "1u", "2u", "3u", "4u", "5u"]) {
      expect(source).toContain(`return ${id};`);
    }
  });

  it("can replace the current 3-species shader selection block", () => {
    const replaced = replaceTreeRingSpeciesSelection(treeRingShader, treeRingSixSpeciesWgslSelectionSource());

    expect(replaced).toContain("params.species_material_birch");
    expect(replaced).toContain("fn append_tree(");
    expect(replaced).not.toContain("let weights = max(vec3<f32>(oak, pine, dead), vec3<f32>(0.0));");
  });
});
