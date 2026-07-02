import { describe, expect, it } from "vitest";
import { withTreeTerrainVisibilityCull } from "./tree_ring_wgsl_transforms.js";

describe("tree ring WGSL transforms", () => {
  it("rewrites tree_cull to read compact active slot indices", () => {
    const source = `fn tree_terrain_visibility_enabled() -> bool {
  return params.terrain_visibility.x > 0.5;
}

fn tree_terrain_debug_counts_enabled() -> bool {
  return false;
}

fn tree_cull(@builtin(global_invocation_id) id: vec3<u32>) {
  process_tree_slot(id.x);
}`;

    const transformed = withTreeTerrainVisibilityCull(source);

    expect(transformed).toContain("@group(0) @binding(12) var<storage, read> tree_active_slot_indices: array<u32>;");
    expect(transformed).toContain("let slot = tree_active_slot_indices[id.x];");
    expect(transformed).toContain("process_tree_slot(slot);");
    expect(transformed).not.toContain("process_tree_slot(id.x);");
  });

  it("throws when the tree_cull entrypoint shape is not recognized", () => {
    const source = `fn tree_terrain_visibility_enabled() -> bool {
  return params.terrain_visibility.x > 0.5;
}

fn tree_terrain_debug_counts_enabled() -> bool {
  return false;
}

fn tree_cull(@builtin(global_invocation_id) id: vec3<u32>) {
  let raw_slot = id.x;
  process_tree_slot(raw_slot);
}`;

    expect(() => withTreeTerrainVisibilityCull(source)).toThrow("tree ring WGSL active-slot transform failed");
  });
});
