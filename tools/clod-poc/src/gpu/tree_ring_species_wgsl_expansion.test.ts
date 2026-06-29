import { describe, expect, it } from "vitest";
import treeRingShader from "./shaders/tree_ring.compute.wgsl?raw";
import { applyTreeRingSpeciesWgslExpansion } from "./tree_ring_species_wgsl_expansion.js";

describe("TREE-9 conditional WGSL expansion helper", () => {
  it("leaves current 3-species WGSL unchanged", () => {
    expect(applyTreeRingSpeciesWgslExpansion(treeRingShader, 3)).toBe(treeRingShader);
  });

  it("applies the full six-species WGSL params and selection blocks", () => {
    const expanded = applyTreeRingSpeciesWgslExpansion(treeRingShader, 6);

    expect(expanded).toContain("species_weights_a: vec4<f32>");
    expect(expanded).toContain("species_weights_b: vec4<f32>");
    expect(expanded).toContain("index_counts_f: vec4<u32>");
    expect(expanded).toContain("params.species_material_spruce");
    expect(expanded).toContain("let willow = base_b.x");
    expect(expanded).toContain("let spruce = base_b.y");
    expect(expanded).toContain("fn append_tree(");
  });

  it("fails clearly for unsupported species counts", () => {
    expect(() => applyTreeRingSpeciesWgslExpansion(treeRingShader, 4)).toThrow(/Unsupported tree ring species count 4/);
  });
});
