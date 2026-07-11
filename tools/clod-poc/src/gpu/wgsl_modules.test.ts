import { describe, expect, it } from "vitest";
import { TREE_SPECIES } from "../trees/tree_config.js";
import { TREE_RING_SHADOW_CASCADE_COUNT } from "../trees/tree_ring_shadow_casters.js";
import { treeRingSpeciesLayout } from "./tree_ring_species_layout.js";
import {
  composeGrassRingShader,
  composeStoneScatterShader,
  composeTerrainFieldShader,
  composeTreeRingShader,
  composeUnderstoryRingShader,
} from "./wgsl_modules.js";

function bindingDeclarationCount(source: string, name: string): number {
  return [...source.matchAll(new RegExp(`\\bvar(?:<[^>]+>)?\\s+${name}\\s*:`, "g"))].length;
}

describe("WGSL module composition", () => {
  it("composes terrain and vegetation shaders without unresolved objects", () => {
    for (const source of [
      composeTerrainFieldShader(),
      composeGrassRingShader(),
      composeStoneScatterShader(),
      composeTreeRingShader(),
      composeUnderstoryRingShader(),
    ]) {
      expect(source).not.toContain("[object Object]");
    }
  });

  it("keeps shared terrain bindings single-instanced in scatter shaders", () => {
    for (const source of [composeGrassRingShader(), composeStoneScatterShader(), composeTreeRingShader(), composeUnderstoryRingShader()]) {
      expect(source).toContain("fn placement_ground_height");
      expect(bindingDeclarationCount(source, "digEdits")).toBe(1);
      expect(bindingDeclarationCount(source, "fieldParams")).toBe(1);
    }
  });

  it("composes tree terrain visibility, visible cluster culling, and final placement height", () => {
    const source = composeTreeRingShader();
    expect(source).toContain("fn tree_pcg2d");
    expect(source).toContain("fn tree_world_cell_from_slot");
    expect(source).toContain("let raw_height = placement_ground_height(wpos.x, wpos.y, params.center_radius.w);");
    expect(source).toContain("let height = raw_height;");
    expect(source).toContain("tree_terrain_visibility_enabled()");
    expect(source).toContain("terrain_ridge_filter(wpos, height, dist)");
    expect(source).toContain("tree_slot_visible_cluster_visible(slot)");
  });

  it("culls terrain-hidden trees before shadows but keeps cluster cull visible-only", () => {
    const source = composeTreeRingShader();
    const terrainReject = source.indexOf("if (terrain_hidden) { return; }");
    const visibleReject = source.indexOf("if (!tree_slot_visible_cluster_visible(slot)) { return; }");
    const speciesSelection = source.indexOf("let species = select_species");
    const scaleSelection = source.indexOf("let scale = tree_instance_scale");
    const shadowAppend = source.indexOf("append_shadow_lod_if_active(species, TREE_LOD_NEAR");
    const visibleAppend = source.indexOf("append_lod_if_active(species, TREE_LOD_NEAR");

    expect(terrainReject).toBeGreaterThan(-1);
    expect(visibleReject).toBeGreaterThan(-1);
    expect(speciesSelection).toBeGreaterThan(-1);
    expect(scaleSelection).toBeGreaterThan(-1);
    expect(shadowAppend).toBeGreaterThan(-1);
    expect(visibleAppend).toBeGreaterThan(-1);
    expect(terrainReject).toBeGreaterThan(speciesSelection);
    expect(terrainReject).toBeGreaterThan(scaleSelection);
    expect(terrainReject).toBeLessThan(shadowAppend);
    expect(visibleReject).toBeGreaterThan(shadowAppend);
    expect(terrainReject).toBeLessThan(visibleAppend);
    expect(visibleReject).toBeLessThan(visibleAppend);
  });

  it("rewrites tree scatter hash and shadow LOD gate", () => {
    const source = composeTreeRingShader();
    expect(source).toContain("return tree_pcg2d(cell, params.settings_u.z + salt).x;");
    expect(source).toContain("return tree_pcg2d(cell, params.settings_u.z + salt);");
    expect(source).toContain("let max_shadow_lod = params.settings_e.z;");
    expect(source).toContain("if (max_shadow_lod < 0.0 || f32(lod) > max_shadow_lod) { return; }");
  });

  it("gives every placement shader exactly one hydrology atlas binding and params accessor", () => {
    for (const source of [composeGrassRingShader(), composeStoneScatterShader(), composeTreeRingShader(), composeUnderstoryRingShader()]) {
      expect(bindingDeclarationCount(source, "hydro_atlas_texture")).toBe(1);
      expect([...source.matchAll(/fn placement_hydro_atlas_params\(\)/g)].length).toBe(1);
      expect(source).toContain("fn placement_sample_hydro_atlas");
      expect(source).toContain("hydro_atlas: vec4<f32>,");
    }
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
});
