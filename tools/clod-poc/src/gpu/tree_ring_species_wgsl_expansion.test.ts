import { describe, expect, it } from "vitest";
import { TREE_SPECIES } from "../trees/tree_config.js";
import treeRingShader from "./shaders/tree_ring.compute.wgsl?raw";
import { applyTreeRingSpeciesWgslExpansion } from "./tree_ring_species_wgsl_expansion.js";
import { composeTreeRingShader } from "./wgsl_modules.js";

describe("TREE-9 conditional WGSL expansion helper", () => {
  it("leaves already-composed WGSL unchanged when expansion is disabled", () => {
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

  it("composes the browser runtime shader with six species", () => {
    const shader = composeTreeRingShader(64);

    expect(TREE_SPECIES).toEqual(["oak", "pine", "dead", "birch", "willow", "spruce"]);
    expect(shader).toContain("const TREE_SPECIES_COUNT: u32 = 6u;");
    expect(shader).toContain("species_weights_a: vec4<f32>");
    expect(shader).toContain("species_weights_b: vec4<f32>");
    expect(shader).toContain("species_material_birch: vec4<f32>");
    expect(shader).toContain("species_material_willow: vec4<f32>");
    expect(shader).toContain("species_material_spruce: vec4<f32>");
    expect(shader).toContain("if (group < 20u) { return params.index_counts_e[group - 16u]; }");
    expect(shader).toContain("return params.index_counts_f[group - 20u];");
  });

  it("keeps generated species selection terrain-aware", () => {
    const shader = composeTreeRingShader(64);

    expect(shader).toContain("fn select_species(wc: vec2<f32>, wpos: vec2<f32>, height: f32, normal_y: f32) -> u32");
    expect(shader).toContain("let materials = tree_material_weights(height, normal_y);");
    expect(shader).toContain("let moisture = 1.0 - clamp((height - WATER_LEVEL) / 42.0, 0.0, 1.0);");
    expect(shader).toContain("if (roll < weights_a.x + weights_a.y + weights_a.z + weights_a.w + weights_b.x) { return 4u; }");
    expect(shader).toContain("return 5u;");
  });

  it("fails clearly for unsupported species counts", () => {
    expect(() => applyTreeRingSpeciesWgslExpansion(treeRingShader, 4)).toThrow(/Unsupported tree ring species count 4/);
  });
});
