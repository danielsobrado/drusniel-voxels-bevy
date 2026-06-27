import { describe, expect, it } from "vitest";
import { DEFAULT_DIAGONAL_FLIP_CONFIG, type ClodPagesConfig } from "../config.js";
import type { Phase0Config } from "../phase0/phase0_config.js";
import { createStreamDiagnosticTracker } from "./stream_diagnostics.js";

const cfg = {
  page: { chunks_per_page: 4, chunk_size: 16, halo_chunks: 1, quadtree_levels: 4 },
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
    show_wireframe: true,
    show_page_boundaries: true,
    show_locked_border_vertices: false,
    show_error_labels: true,
    show_stats_panel: true,
    lod_colors: { lod0: "#3b82f6", lod1: "#22c55e", lod2: "#f59e0b", lod3: "#ef4444" },
  },
  stress: { active_scene: "ridge_border" },
  meshopt_package_version: "0.22.0",
  poc: { lod0_pages_x: 8, lod0_pages_z: 8, smoke_lod0_pages_x: 4, smoke_lod0_pages_z: 4, emit_debug_json: true, emit_debug_obj: false },
  validation: { position_epsilon: 0.000001, normal_dot_min: 0.9999, material_weight_epsilon: 0.0001, zero_area_epsilon: 0.00000001 },
} satisfies ClodPagesConfig;

const phase0Config = {
  phase0: {
    target_visible_m: 4096,
    target_future_visible_m: 8192,
    streaming: { preload_seconds: 4, live_radius_m: 200, clod_radius_m: 2048 },
    scenes: {},
  },
  metrics: { required_counters: [] },
  acceptance: {
    allow_current_4km_failure: true,
    visible_target_required_for_future_phases: true,
    max_horizon_hole_ratio: 0,
    max_streamer_simulated_missing_chunks: 0,
    max_streamer_simulated_missing_pages: 0,
  },
} satisfies Phase0Config;

describe("stream diagnostics", () => {
  it("publishes live and visual page snapshots", () => {
    const tracker = createStreamDiagnosticTracker({
      cfg,
      maxTerrainLevel: 3,
      phase0Config,
      phase0TargetVisibleM: 4096,
      queryScene: "infinite-stream-straight",
    });

    const snapshot = tracker.update({ x: 0, z: 0 });

    expect(snapshot.ownership.liveRadiusM).toBe(200);
    expect(snapshot.ownership.clodRadiusM).toBe(2048);
    expect(snapshot.ownership.farShellInnerM).toBe(2048);
    expect(snapshot.ownership.farShellOuterM).toBe(8192);
    expect(snapshot.live.required.length).toBeGreaterThan(0);
    expect(snapshot.visualPages.required.length).toBeGreaterThan(0);
    expect(tracker.format(snapshot)).toContain("far-shell>=2048m");
  });

  it("returns the latest snapshot without updating the center", () => {
    const tracker = createStreamDiagnosticTracker({
      cfg,
      maxTerrainLevel: 3,
      phase0Config,
      phase0TargetVisibleM: 4096,
      queryScene: "infinite-stream-straight",
    });

    const updated = tracker.update({ x: 128, z: 256 });
    const snapshot = tracker.snapshot();

    expect(snapshot.center).toEqual({ x: 128, z: 256 });
    expect(snapshot.live.required).toEqual(updated.live.required);
    expect(snapshot.visualPages.required).toEqual(updated.visualPages.required);
    expect(snapshot.ownership.farShellInnerM).toBe(2048);
  });
});
