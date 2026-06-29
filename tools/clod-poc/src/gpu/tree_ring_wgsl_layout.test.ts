import { describe, expect, it } from "vitest";
import treeRingShader from "./shaders/tree_ring.compute.wgsl?raw";
import { treeRingSpeciesLayout } from "./tree_ring_species_layout.js";
import { applyTreeRingWgslLayoutConstants, treeRingWgslLayoutConstants } from "./tree_ring_wgsl_layout.js";

describe("tree ring WGSL layout constants", () => {
  it("generates current 3-species constants", () => {
    const constants = treeRingWgslLayoutConstants(treeRingSpeciesLayout(3, 4));

    expect(constants).toContain("const TREE_SPECIES_COUNT: u32 = 3u;");
    expect(constants).toContain("const TREE_GROUP_COUNT: u32 = 12u;");
    expect(constants).toContain("const TREE_SHADOW_GROUP_COUNT: u32 = 48u;");
  });

  it("generates future 6-species constants", () => {
    const constants = treeRingWgslLayoutConstants(treeRingSpeciesLayout(6, 4));

    expect(constants).toContain("const TREE_SPECIES_COUNT: u32 = 6u;");
    expect(constants).toContain("const TREE_GROUP_COUNT: u32 = 24u;");
    expect(constants).toContain("const TREE_SHADOW_GROUP_COUNT: u32 = 96u;");
  });

  it("replaces only the layout constant block", () => {
    const updated = applyTreeRingWgslLayoutConstants(treeRingShader, treeRingSpeciesLayout(6, 4));

    expect(updated).toContain("const TREE_WORKGROUP_SIZE: u32 = 64u;");
    expect(updated).toContain("const TREE_SPECIES_COUNT: u32 = 6u;");
    expect(updated).toContain("const TREE_GROUP_COUNT: u32 = 24u;");
    expect(updated).toContain("const TREE_SHADOW_GROUP_COUNT: u32 = 96u;");
    expect(updated).toContain("struct TreeRingParams");
  });
});
