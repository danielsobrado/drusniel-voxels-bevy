import { describe, expect, it } from "vitest";
import grassRingComputeSource from "./grass_ring_compute.ts?raw";
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
  it("composes grass ring with explicit grass field bindings and shared terrain functions", () => {
    const source = composeGrassRingShader();

    expect(source).toContain("@group(0) @binding(7)");
    expect(source).toContain("@group(0) @binding(8)");
    expect(source).toContain("fn surfaceHeightField");
    expect(source).toContain("fn placement_border_coast_height");
    expect(source).toContain("fn densityGradient");
    expect(source).toContain("fn grass_cull");
    expect(source).not.toContain("replace(");
    expect(bindingDeclarationCount(source, "digEdits")).toBe(1);
    expect(bindingDeclarationCount(source, "fieldParams")).toBe(1);
  });

  it("rewrites grass frustum culling to the conservative sphere test", () => {
    const source = composeGrassRingShader();

    expect(source).toContain("fn in_frustum_sphere");
    expect(source).toContain("in_frustum_sphere(blade_center, blade_radius)");
    expect(source).not.toMatch(/\bin_frustum\(/);
  });

  it("composes terrain mesh with explicit terrain field bindings and no grass entry points", () => {
    const source = composeTerrainFieldShader();

    expect(source).toContain("@group(0) @binding(0)");
    expect(source).toContain("@group(0) @binding(1)");
    expect(source).toContain("fn surfaceHeightField");
    expect(source).toContain("fn densityGradient");
    expect(source).not.toContain("fn grass_cull");
    expect(source).not.toContain("fn build_indirect_args");
    expect(bindingDeclarationCount(source, "digEdits")).toBe(1);
    expect(bindingDeclarationCount(source, "fieldParams")).toBe(1);
  });

  it("keeps existing stone scatter composition on explicit field bindings", () => {
    const source = composeStoneScatterShader();

    expect(source).toContain("@group(0) @binding(5)");
    expect(source).toContain("@group(0) @binding(6)");
    expect(source).toContain("@group(0) @binding(7) var hydro_texture");
    expect(source).toContain("@group(0) @binding(8) var hydro_sampler");
    expect(source).toContain("fn placement_border_coast_height");
    expect(source).toContain("fn scatter_stones");
    expect(bindingDeclarationCount(source, "digEdits")).toBe(1);
    expect(bindingDeclarationCount(source, "fieldParams")).toBe(1);
    expect(source.match(/^@group\(0\) @binding\(7\) var hydro_texture:/gm)).toHaveLength(1);
    expect(source.match(/^@group\(0\) @binding\(8\) var hydro_sampler:/gm)).toHaveLength(1);
  });

  it("composes tree ring helpers with final terrain placement height", () => {
    const source = composeTreeRingShader();

    expect(source).toContain("@group(0) @binding(7)");
    expect(source).toContain("@group(0) @binding(8)");
    expect(source).toContain("fn surfaceHeightField");
    expect(source).toContain("fn placement_border_coast_height");
    expect(source).toContain("fn densityGradient");
    expect(source).toContain("fn tree_pcg2d");
    expect(source).toContain("fn tree_world_cell_from_slot");
    expect(source).toContain("fn tree_accept_mask");
    expect(source).toContain("fn tree_lod_ring");
    expect(source).toContain("let raw_height = placement_ground_height(wpos.x, wpos.y, params.center_radius.w);");
    expect(source).toContain("let height = raw_height;");
    expect(source).toContain("let normal_y = tree_height_normal_y(wpos);");
    expect(source).not.toContain("densityGradient(wpos.x, height, wpos.y)");
    expect(source).not.toContain("terrain_ridge_filter(wpos, height, dist)");
    expect(source).not.toContain("tree_terrain_roughness_mask");
    expect(bindingDeclarationCount(source, "digEdits")).toBe(1);
    expect(bindingDeclarationCount(source, "fieldParams")).toBe(1);
  });

  it("rewrites tree scatter hash to integer PCG", () => {
    const source = composeTreeRingShader();

    expect(source).toContain("return tree_pcg2d(cell, params.settings_u.z + salt).x;");
    expect(source).toContain("return tree_pcg2d(cell, params.settings_u.z + salt);");
    expect(source).not.toContain("fract(sin(dot(cell");
  });

  it("injects tree ring layout constants from TS layout helpers", () => {
    const source = composeTreeRingShader();
    const layout = treeRingSpeciesLayout(TREE_SPECIES.length, TREE_RING_SHADOW_CASCADE_COUNT);

    expect(source).toContain(`const TREE_LOD_COUNT: u32 = ${layout.lodCount}u;`);
    expect(source).toContain(`const TREE_SPECIES_COUNT: u32 = ${layout.speciesCount}u;`);
    expect(source).toContain(`const TREE_GROUP_COUNT: u32 = ${layout.groupCount}u;`);
    expect(source).toContain(`const TREE_SHADOW_CASCADE_COUNT: u32 = ${layout.shadowCascadeCount}u;`);
    expect(source).toContain(`const TREE_SHADOW_GROUP_COUNT: u32 = ${layout.shadowGroupCount}u;`);
    expect(source).not.toContain("const TREE_GROUP_COUNT: u32 = TREE_SPECIES_COUNT * TREE_LOD_COUNT;");
  });

  it("composes understory ring with explicit understory field bindings and shared terrain functions", () => {
    const source = composeUnderstoryRingShader();

    expect(source).toContain("const WATER_LEVEL : f32 = 18.0;");
    expect(source).toContain("@group(0) @binding(7)");
    expect(source).toContain("@group(0) @binding(8)");
    expect(source).toContain("fn surfaceHeightField");
    expect(source).toContain("fn placement_border_coast_height");
    expect(source).toContain("fn densityGradient");
    expect(source).toContain("fn understory_cull");
    expect(bindingDeclarationCount(source, "digEdits")).toBe(1);
    expect(bindingDeclarationCount(source, "fieldParams")).toBe(1);
  });

  it("removes grass runtime WGSL binding remap logic", () => {
    expect(grassRingComputeSource).not.toContain("remapTerrainFieldBindings");
    expect(grassRingComputeSource).not.toContain(".replace(/@group");
    expect(grassRingComputeSource).not.toContain("terrain_field.wgsl?raw");
  });
});
