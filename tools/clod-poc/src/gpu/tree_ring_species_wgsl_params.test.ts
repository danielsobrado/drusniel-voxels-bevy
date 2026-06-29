import { describe, expect, it } from "vitest";
import treeRingShader from "./shaders/tree_ring.compute.wgsl?raw";
import {
  replaceTreeRingIndexCountFunction,
  replaceTreeRingParamsStruct,
  treeRingSixSpeciesIndexCountSource,
  treeRingSixSpeciesParamsStructSource,
} from "./tree_ring_species_wgsl_params.js";

describe("TREE-9 six-species WGSL params source", () => {
  it("defines two species-weight vec4s and six material vectors", () => {
    const source = treeRingSixSpeciesParamsStructSource();

    expect(source).toContain("species_weights_a: vec4<f32>");
    expect(source).toContain("species_weights_b: vec4<f32>");
    expect(source).toContain("species_material_oak: vec4<f32>");
    expect(source).toContain("species_material_pine: vec4<f32>");
    expect(source).toContain("species_material_dead: vec4<f32>");
    expect(source).toContain("species_material_birch: vec4<f32>");
    expect(source).toContain("species_material_willow: vec4<f32>");
    expect(source).toContain("species_material_spruce: vec4<f32>");
  });

  it("defines six vec4 index-count groups for 24 visible groups", () => {
    const source = treeRingSixSpeciesParamsStructSource();
    const indexSource = treeRingSixSpeciesIndexCountSource();

    for (const suffix of ["a", "b", "c", "d", "e", "f"]) {
      expect(source).toContain(`index_counts_${suffix}: vec4<u32>`);
      expect(indexSource).toContain(`params.index_counts_${suffix}`);
    }
    expect(indexSource).toContain("group < 20u");
    expect(indexSource).toContain("group - 20u");
  });

  it("can replace the current TreeRingParams struct", () => {
    const replaced = replaceTreeRingParamsStruct(treeRingShader, treeRingSixSpeciesParamsStructSource());

    expect(replaced).toContain("species_weights_b: vec4<f32>");
    expect(replaced).toContain("species_material_spruce: vec4<f32>");
    expect(replaced).toContain("struct TreeHydrologySample");
    expect(replaced).not.toContain("species_weights: vec4<f32>");
  });

  it("can replace the current index-count lookup function", () => {
    const replaced = replaceTreeRingIndexCountFunction(treeRingShader, treeRingSixSpeciesIndexCountSource());

    expect(replaced).toContain("params.index_counts_f[group - 20u]");
    expect(replaced).toContain("fn in_frustum(");
    expect(replaced).not.toContain("return params.index_counts_c[group - 8u];\n}");
  });
});
