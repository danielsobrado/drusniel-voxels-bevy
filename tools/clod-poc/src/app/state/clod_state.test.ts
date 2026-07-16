import { describe, expect, it } from "vitest";
import type { ClodPagesConfig } from "../../config.js";
import { createClodSliceState } from "./clod_state.js";

const cfg: ClodPagesConfig = {
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
  meshopt_package_version: "test",
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
    normal_dot_min: 0.9999,
    material_weight_epsilon: 0.0001,
    zero_area_epsilon: 0.000001,
  },
};

function createState(liveBubbleDefault?: { enabled: boolean; radiusM: number; pinned?: boolean }) {
  return createClodSliceState({
    cfg,
    queryPerfMode: true,
    queryWebGpuSelection: true,
    queryMaterialTiers: false,
    queryFarShell: false,
    isLongView: true,
    profileEnabled: false,
    liveBubbleDefault,
  });
}

describe("createClodSliceState", () => {
  it("enables the master terrain streaming switch by default", () => {
    expect(createState().terrainStreamingEnabled).toBe(true);
  });

  it("records the live bubble default and pin flag", () => {
    const state = createState({ enabled: true, radiusM: 200, pinned: true });

    expect(state.bubble).toBe(true);
    expect(state.liveBubblePinned).toBe(true);
    expect(state.bubbleRadius).toBe(200);
  });

  it("allows user code to turn the bubble off", () => {
    const state = createState({ enabled: true, radiusM: 200, pinned: true });

    state.bubble = false;
    expect(state.bubble).toBe(false);
    expect(state.liveBubblePinned).toBe(true);
  });

  it("keeps the legacy finite bubble default when no live default is present", () => {
    const state = createState();

    expect(state.bubble).toBe(false);
    expect(state.liveBubblePinned).toBe(false);
    expect(state.bubbleRadius).toBe(96);
  });

  it("does not pin a false live bubble default", () => {
    const state = createState({ enabled: false, radiusM: 128, pinned: false });

    expect(state.bubble).toBe(false);
    expect(state.liveBubblePinned).toBe(false);
    expect(state.bubbleRadius).toBe(128);
  });
});
