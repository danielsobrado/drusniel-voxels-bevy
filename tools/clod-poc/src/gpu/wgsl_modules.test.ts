import { describe, expect, it } from "vitest";
import {
  composeGrassRingShader,
  composeStoneScatterShader,
  composeTerrainFieldShader,
  composeTreeRingShader,
  composeUnderstoryRingShader,
} from "./wgsl_modules.js";
import { TREE_SPECIES } from "../trees/tree_config.js";
import { TREE_RING_SHADOW_CASCADE_COUNT } from "../trees/tree_ring_shadow_casters.js";
import { treeRingSpeciesLayout } from "./tree_ring_species_layout.js";

function bindingDeclarationCount(source: string, name: "digEdits" | "fieldParams"): number {
  return source.match(new RegExp(`\\bvar<[^>]+>\\s+${name}\\s*:`, "g"))?.length ?? 0;
}

describe("WGSL module composition", () => {
  it("composes grass ring with explicit field bindings and conservative frustum", () => {
    const source = composeGrassRingShader();
    expect(source).toContain("fn in_frustum_sphere");
    expect(source).toContain("fn grass_cull");
    expect(bindingDeclarationCount(source, "digEdits")).toBe(1);
    expect(bindingDeclarationCount(source, "fieldParams")).toBe(1);
  });

  it("composes terrain and stone shaders with shared terrain helpers", () => {
    expect(composeTerrainFieldShader()).toContain("fn surfaceHeightField");
    const stone = composeStoneScatterShader();
    expect(stone).toContain("fn placement_border_coast_height");
    expect(stone).toContain("fn scatter_stones");
  });

  it("composes tree ring helpers with final terrain placement height", () => {
    const source = composeTreeRingShader();
    expect(source).toContain("fn tree_pcg2d");
    expect(source).toContain("fn tree_world_cell_from_slot");
    expect(source).toContain("fn tree_accept_mask");
    expect(source).toContain("fn tree_lod_ring");
    expect(source).toContain("let raw_height = placement_ground_height(wpos.x, wpos.y, params.center_radius.w);");
    expect(source).toContain("let height = raw_height;");
    expect(source).toContain("let normal_y = tree_height_normal_y(wpos);");
    expect(source).toContain("tree_terrain_visibility_enabled()");
    expect(source).toContain("terrain_ridge_filter(wpos, height, dist)");
    expect(bindingDeclarationCount(source, "digEdits")).toBe(1);
    expect(bindingDeclarationCount(source, "fieldParams")).toBe(1);
  });

  it("rewrites tree scatter hash to integer PCG", () => {
    const source = composeTreeRingShader();
    expect(source).toContain("return tree_pcg2d(cell, params.settings_u.z + salt).x;");
    expect(source).toContain("return tree_pcg2d(cell, params.settings_u.z + salt);");
  });

  it("gates GPU tree shadow appends by max shadow LOD", () => {
    const source = composeTreeRingShader();
    expect(source).toContain("let max_shadow_lod = params.settings_e.z;");
    expect(source).toContain("if (max_shadow_lod < 0.0 || f32(lod) > max_shadow_lod) { return; }");
  });

  it("injects tree ring layout constants from TS layout helpers", () => {
    const source = composeTreeRingShader();
    const layout = treeRingSpeciesLayout(TREE_SPECIES.length, TREE_RING_SHADOW_CASCADE_COUNT);
    expect(source).toContain(`const TREE_LOD_COUNT: u32 = ${layout.lodCount}u;`);
    expect(source).toContain(`const TREE_SPECIES_COUNT: u32 = ${layout.speciesCount}u;`);
    expect(source).toContain(`const TREE_GROUP_COUNT: u32 = ${layout.groupCount}u;`);
    expect(source).toContain(`const TREE_SHADOW_CASCADE_COUNT: u32 = ${layout.shadowCascadeCount}u;`);
    expect(source).toContain(`const TREE_SHADOW_GROUP_COUNT: u32 = ${layout.shadowGroupCount}u;`);
  });

  it("composes understory ring with explicit field bindings and shared terrain functions", () => {
    const source = composeUnderstoryRingShader();
    expect(source).toContain("fn surfaceHeightField");
    expect(source).toContain("fn understory_cull");
    expect(bindingDeclarationCount(source, "digEdits")).toBe(1);
    expect(bindingDeclarationCount(source, "fieldParams")).toBe(1);
  });
});
