import { describe, expect, it } from "vitest";
import type { AcceptanceConfig } from "./acceptanceTypes.js";
import { parseAcceptanceConfig } from "./acceptanceConfig.js";
import { runGateA7 } from "./streamingWalkBatteryGate.js";
import type { ClodPagesConfig } from "../config.js";

function clodConfig(): ClodPagesConfig {
  return {
    page: {
      chunks_per_page: 4,
      chunk_size: 16,
      halo_chunks: 1,
      quadtree_levels: 4,
    },
    simplify: {
      target_ratio_per_level: 0.5,
      abandon_ratio: 0.85,
      target_error: 0.01,
      weld_epsilon_cells: 0.001,
      attribute_weights: { normal: 0.5, material: 1 },
    },
    polish: {
      diagonal_flip: {
        enabled: true,
        min_triangle_area: 0.000001,
        min_normal_dot: 0.05,
        min_angle_improvement_degrees: 2,
        normal_error_weight: 1,
        angle_quality_weight: 1,
        material_error_weight: 0.25,
      },
    },
    selection: {
      error_threshold_px: 1,
      hysteresis_merge_factor: 1.5,
      neighbor_level_delta_max: 1,
      transition_mode: "dither",
      crossfade_frames: 12,
      freeze_selection: false,
    },
    near_field: { enabled: true, radius_chunks: 6, show_mask: true },
    debug: {
      show_wireframe: true,
      show_page_boundaries: true,
      show_locked_border_vertices: false,
      show_error_labels: true,
      show_stats_panel: true,
      lod_colors: { lod0: "#000", lod1: "#111", lod2: "#222", lod3: "#333" },
    },
    stress: { active_scene: "ridge_border" },
    meshopt_package_version: "0.22.0",
    poc: {
      lod0_pages_x: 8,
      lod0_pages_z: 8,
      smoke_lod0_pages_x: 4,
      smoke_lod0_pages_z: 4,
      emit_debug_json: true,
      emit_debug_obj: false,
    },
    validation: {
      position_epsilon: 0.000001,
      normal_dot_min: 0.9999,
      material_weight_epsilon: 0.0001,
      zero_area_epsilon: 0.00000001,
    },
  };
}

function configYaml(overrides = ""): string {
  return `
acceptance:
  output_dir: acceptance-runs
  world:
    lod0_pages_x: 4
    lod0_pages_z: 4
    smoke_lod0_pages_x: 2
    smoke_lod0_pages_z: 2
  thresholds:
    border_position_epsilon: 0.000001
    border_normal_dot_min: 0.9999
    border_material_weight_delta_max: 0.0001
    lod3_triangle_ratio_max: 0.15
    low_benefit_rate_max: 0.10
    full_hierarchy_build_ms_max: 8000
    single_node_rebuild_ms_max: 100
    density_scar_score_max: 0.35
    visual_hole_pixel_ratio_max: 0.0
    visual_lip_pixel_ratio_max: 0.0
    require_measured_single_node_rebuild: false
  visual:
    enabled: false
    screenshot_width: 640
    screenshot_height: 360
    camera_fov_y_deg: 60
    grazing_angle_deg: 7
    crossfade_frames: 12
  stress_scenes:
    ridge_border: true
    cliff_corner: false
    cave_mouth_border: false
    thin_bridge: false
    forced_neighbor_lod_deltas: [1]
    near_field_bubble_mask: true
  streaming_walk:
    enabled: true
    frames: 8
    step_m: 32
    live_radius_m: 128
    clod_radius_m: 512
    far_shell_outer_m: 2048
    hysteresis_m: 128
    coverage_cell_m: 64
    max_clod_level: 3
    biome_probe_distance_m: 160
    max_center_drift_m: 0.001
    max_gap_holes: 100000
    max_overlap_cells: 100000
    max_horizon_hole_ratio: 1.0
    max_active_biome_textures: 2
${overrides}
  logging:
    level: info
`;
}

function config(overrides = ""): AcceptanceConfig {
  return parseAcceptanceConfig(configYaml(overrides));
}

describe("streaming walk battery gate", () => {
  it("parses streaming walk acceptance config", () => {
    const parsed = config();

    expect(parsed.streamingWalk.enabled).toBe(true);
    expect(parsed.streamingWalk.frames).toBe(8);
    expect(parsed.streamingWalk.maxActiveBiomeTextures).toBe(2);
  });

  it("runs the deterministic streaming walk battery", () => {
    const gate = runGateA7(clodConfig(), config());

    expect(gate.id).toBe("A7");
    expect(gate.measurements.frames).toBe(8);
    expect(gate.measurements.maxActiveBiomeTextures).toBeLessThanOrEqual(2);
  });

  it("fails when the accepted biome texture window is below the required cap", () => {
    const gate = runGateA7(clodConfig(), config("    max_active_biome_textures: 1\n"));

    expect(gate.status).toBe("fail");
    expect(gate.failures.some((failure) => failure.code === "STREAMING_BIOME_TEXTURE_WINDOW")).toBe(true);
  });
});
