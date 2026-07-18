import { describe, expect, it } from "vitest";
import { DEFAULT_DIAGONAL_FLIP_CONFIG } from "../config.js";
import { validateProjectArchiveConfig } from "./project_archive_config.js";

function config() {
  return {
    page: { chunks_per_page: 2, chunk_size: 16, halo_chunks: 1, quadtree_levels: 2 },
    simplify: {
      target_ratio_per_level: 0.5,
      abandon_ratio: 0.85,
      target_error: 0.01,
      weld_epsilon_cells: 0.001,
      attribute_weights: { normal: 0.5, material: 1 },
    },
    polish: { diagonal_flip: DEFAULT_DIAGONAL_FLIP_CONFIG },
    selection: {
      error_threshold_px: 1,
      hysteresis_merge_factor: 1.5,
      neighbor_level_delta_max: 1,
      transition_mode: "instant",
      crossfade_frames: 12,
      freeze_selection: false,
    },
    near_field: { enabled: true, radius_chunks: 6, show_mask: true },
    debug: {
      show_wireframe: false,
      show_page_boundaries: false,
      show_locked_border_vertices: false,
      show_error_labels: false,
      show_stats_panel: false,
      lod_colors: { lod0: "#fff", lod1: "#fff", lod2: "#fff", lod3: "#fff" },
    },
    stress: { active_scene: "default" },
    meshopt_package_version: "0.22.0",
    poc: {
      lod0_pages_x: 8,
      lod0_pages_z: 8,
      smoke_lod0_pages_x: 4,
      smoke_lod0_pages_z: 4,
      emit_debug_json: false,
      emit_debug_obj: false,
    },
    validation: {
      position_epsilon: 0.000001,
      normal_dot_min: 0.999,
      material_weight_epsilon: 0.0001,
      zero_area_epsilon: 0.00000001,
    },
  };
}

describe("project archive CLOD config", () => {
  it("canonicalizes a valid snapshot through the production parser", () => {
    expect(validateProjectArchiveConfig(config()).page.chunk_size).toBe(16);
  });

  it("rejects missing or mistyped production fields", () => {
    const invalid = config() as Record<string, unknown>;
    invalid.selection = { transition_mode: "instant" };
    expect(() => validateProjectArchiveConfig(invalid)).toThrow(/invalid CLOD config snapshot/i);
  });

  it("rejects allocation-amplifying page and POC sizes", () => {
    const hugePage = config();
    hugePage.page.chunk_size = 100_000;
    expect(() => validateProjectArchiveConfig(hugePage)).toThrow(/page\.chunk_size.*limit/i);

    const hugePoc = config();
    hugePoc.poc.lod0_pages_x = 10_000;
    expect(() => validateProjectArchiveConfig(hugePoc)).toThrow(/poc\.lod0_pages_x.*limit/i);
  });
});
