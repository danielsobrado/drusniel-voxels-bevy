import { describe, expect, it } from "vitest";
import { TREE_SPECIES } from "../trees/tree_config.js";
import { TREE_RING_SHADOW_CASCADE_COUNT } from "./tree_ring_wgsl_layout.js";
import { treeRingSpeciesLayout } from "./tree_ring_species_layout.js";
import {
  composeGrassRingShader,
  composeStoneScatterShader,
  composeTerrainFieldShader,
  composeTreeRingShader,
  composeUnderstoryRingShader,
} from "./wgsl_modules.js";

function bindingDeclarationCount(source: string, name: string): number {
  return [...source.matchAll(new RegExp(`\\bvar\\s+${name}\\s*:`, "g"))].length;
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

  it("composes tree terrain visibility and final placement height", () => {
    const source = composeTreeRingShader();
    expect(source).toContain("fn tree_pcg2d");
    expect(source).toContain("fn tree_world_cell_from_slot");
    expect(source).toContain("let raw_height = placement_ground_height(wpos.x, wpos.y, params.center_radius.w);");
    expect(source).toContain("let height = raw_height;");
    expect(source).toContain("tree_terrain_visibility_enabled()");
    expect(source).toContain("terrain_ridge_filter(wpos, height, dist)");
  });

  it("returns on terrain-hidden trees before visible and shadow appends", () => {
    const source = composeTreeRingShader();
    const hiddenReturn = source.indexOf("if (terrain_hidden) { return; }");
    const shadowAppend = source.indexOf("append_shadow_lod_if_active(species, TREE_LOD_NEAR");
    const visibleAppend = source.indexOf("append_lod_if_active(species, TREE_LOD_NEAR");

    expect(hiddenReturn).toBeGreaterThan(-1);
    expect(shadowAppend).toBeGreaterThan(-1);
    expect(visibleAppend).toBeGreaterThan(-1);
    expect(hiddenReturn).toBeLessThan(shadowAppend);
    expect(hiddenReturn).toBeLessThan(visibleAppend);
  });

  it("rewrites tree scatter hash and shadow LOD gate", () => {
    const source = composeTreeRingShader();
    expect(source).toContain("return tree_pcg2d(cell, params.settings_u.z + salt).x;");
    expect(source).toContain("return tree_pcg2d(cell, params.settings_u.z + salt);");
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
});
