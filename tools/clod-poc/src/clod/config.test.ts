import { describe, expect, it } from "vitest";
import { parseConfig, type ClodPagesConfig } from "../config.js";
import configText from "../../config/clod_pages.yaml?raw";

describe("parseConfig", () => {
  it("loads valid YAML without error", () => {
    const cfg = parseConfig(configText);
    expect(cfg.page.chunks_per_page).toBe(4);
    expect(cfg.page.chunk_size).toBe(16);
    expect(cfg.page.quadtree_levels).toBe(4);
    expect(cfg.simplify.target_ratio_per_level).toBe(0.5);
    expect(cfg.simplify.abandon_ratio).toBe(0.85);
    expect(cfg.meshopt_package_version).toBe("0.22.0");
    expect(cfg.poc.lod0_pages_x).toBe(8);
    expect(cfg.validation.position_epsilon).toBe(0.000001);
  });

  it("returns typed config object", () => {
    const cfg: ClodPagesConfig = parseConfig(configText);
    expect(typeof cfg.page.chunks_per_page).toBe("number");
    expect(typeof cfg.simplify.attribute_weights.normal).toBe("number");
    expect(typeof cfg.poc.emit_debug_json).toBe("boolean");
  });

  it("fails on missing required key", () => {
    const bad = `page:\n  chunks_per_page: 4\n  chunk_size: 16\n  quadtree_levels: 4`;
    expect(() => parseConfig(bad)).toThrow();
  });

  it("fails on invalid numeric value below minimum", () => {
    const bad = `page:
  chunks_per_page: 0
  chunk_size: 16
  halo_chunks: 1
  quadtree_levels: 4
simplify:
  target_ratio_per_level: 0.5
  abandon_ratio: 0.85
  target_error: 0.01
  weld_epsilon_cells: 0.001
  attribute_weights:
    normal: 0.5
    material: 1.0
polish:
  diagonal_flip:
    enabled: true
    min_triangle_area: 0.000001
    min_normal_dot: 0.05
    min_angle_improvement_degrees: 2.0
    normal_error_weight: 1.0
    angle_quality_weight: 1.0
    material_error_weight: 0.25
selection:
  error_threshold_px: 1.0
  hysteresis_merge_factor: 1.5
  neighbor_level_delta_max: 1
  transition_mode: instant
  crossfade_frames: 0
near_field:
  radius_chunks: 6
meshopt_package_version: "0.22.0"
poc:
  lod0_pages_x: 8
  lod0_pages_z: 8
  smoke_lod0_pages_x: 4
  smoke_lod0_pages_z: 4
  emit_debug_json: true
  emit_debug_obj: false
validation:
  position_epsilon: 0.000001
  normal_dot_min: 0.9999
  material_weight_epsilon: 0.0001
  zero_area_epsilon: 0.00000001`;
    expect(() => parseConfig(bad)).toThrow(/finite number/);
  });

  it("fails on missing poc section", () => {
    const bad = `page:
  chunks_per_page: 2
  chunk_size: 16
  halo_chunks: 0
  quadtree_levels: 2
simplify:
  target_ratio_per_level: 0.5
  abandon_ratio: 0.85
  target_error: 0.01
  weld_epsilon_cells: 0.001
  attribute_weights:
    normal: 0.5
    material: 1.0
polish:
  diagonal_flip:
    enabled: false
    min_triangle_area: 0.000001
    min_normal_dot: 0.05
    min_angle_improvement_degrees: 2
    normal_error_weight: 1
    angle_quality_weight: 1
    material_error_weight: 0.25
selection:
  error_threshold_px: 1
  hysteresis_merge_factor: 1.5
  neighbor_level_delta_max: 1
  transition_mode: instant
  crossfade_frames: 0
near_field:
  radius_chunks: 0
meshopt_package_version: "0.22.0"`;
    expect(() => parseConfig(bad)).toThrow();
  });

  it("fails on invalid transition_mode", () => {
    const bad = `page:
  chunks_per_page: 2
  chunk_size: 16
  halo_chunks: 0
  quadtree_levels: 2
simplify:
  target_ratio_per_level: 0.5
  abandon_ratio: 0.85
  target_error: 0.01
  weld_epsilon_cells: 0.001
  attribute_weights:
    normal: 0.5
    material: 1.0
polish:
  diagonal_flip:
    enabled: false
    min_triangle_area: 0.000001
    min_normal_dot: 0.05
    min_angle_improvement_degrees: 2
    normal_error_weight: 1
    angle_quality_weight: 1
    material_error_weight: 0.25
selection:
  error_threshold_px: 1
  hysteresis_merge_factor: 1.5
  neighbor_level_delta_max: 1
  transition_mode: fade
  crossfade_frames: 0
near_field:
  radius_chunks: 0
meshopt_package_version: "0.22.0"
poc:
  lod0_pages_x: 8
  lod0_pages_z: 8
  smoke_lod0_pages_x: 4
  smoke_lod0_pages_z: 4
  emit_debug_json: true
  emit_debug_obj: false
validation:
  position_epsilon: 0.000001
  normal_dot_min: 0.9999
  material_weight_epsilon: 0.0001
  zero_area_epsilon: 0.00000001`;
    expect(() => parseConfig(bad)).toThrow(/transition_mode/);
  });
});
