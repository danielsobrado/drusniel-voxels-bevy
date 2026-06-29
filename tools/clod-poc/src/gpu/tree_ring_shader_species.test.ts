import { describe, expect, it } from "vitest";
import shaderSource from "./shaders/tree_ring.compute.wgsl?raw";

describe("tree ring compute shader TREE-9 species contract", () => {
  it("uses six species and six material vectors", () => {
    expect(shaderSource).toContain("const TREE_SPECIES_COUNT: u32 = 6u");
    expect(shaderSource).toContain("species_weights_a: vec4<f32>");
    expect(shaderSource).toContain("species_weights_b: vec4<f32>");
    expect(shaderSource).toContain("species_material_birch: vec4<f32>");
    expect(shaderSource).toContain("species_material_willow: vec4<f32>");
    expect(shaderSource).toContain("species_material_spruce: vec4<f32>");
  });

  it("has index count vectors for all 24 species/lod groups", () => {
    for (const name of ["index_counts_a", "index_counts_b", "index_counts_c", "index_counts_d", "index_counts_e", "index_counts_f"]) {
      expect(shaderSource).toContain(`${name}: vec4<u32>`);
    }
    expect(shaderSource).toContain("if (group < 20u) { return params.index_counts_e[group - 16u]; }");
    expect(shaderSource).toContain("return params.index_counts_f[group - 20u];");
  });

  it("selects birch willow and spruce as first-class species", () => {
    expect(shaderSource).toContain("base[3] = base[3] * species_material_bias(3u, materials)");
    expect(shaderSource).toContain("base[4] = base[4] * species_material_bias(4u, materials)");
    expect(shaderSource).toContain("base[5] = base[5] * species_material_bias(5u, materials)");
    expect(shaderSource).toContain("for (var i = 0u; i < TREE_SPECIES_COUNT; i = i + 1u)");
  });
});
