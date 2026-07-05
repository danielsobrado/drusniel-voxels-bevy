import { describe, expect, it } from "vitest";
import { evaluateThresholds, REQUIRED_COUNTERS } from "./thresholds.js";

function validCounters(overrides: Record<string, number> = {}): Record<string, number> {
  const values = Object.fromEntries(REQUIRED_COUNTERS.map((key) => [key, 0]));
  values["frame_ms_p95"] = 8;
  values["frame_ms_p99"] = 9;
  values["target_visible_m"] = 4096;
  values["far_shell_inner_minus_clod_radius_m"] = -384;
  values["streamer_far_shell_ownership_ok"] = 1;
  values["streamer_live_radius_m"] = 200;
  values["streamer_clod_radius_m"] = 768;
  values["live_bubble_required_pages"] = 1;
  values["live_bubble_ready_pages"] = 1;
  values["live_bubble_streamed_collider_pages"] = 1;
  values["live_bubble_collider_registrations"] = 1;
  values["live_bubble_gpu_dispatch_budget"] = 12;
  values["live_bubble_max_inflight_chunks"] = 128;
  values["live_bubble_ready_visual_pages"] = 1;
  values["live_bubble_visual_required_pages"] = 1;
  values["live_bubble_visual_ready_pages"] = 1;
  values["live_bubble_collider_required_pages"] = 1;
  values["live_bubble_collider_ready_pages"] = 1;
  values["live_clod_stream_required_pages"] = 1;
  values["live_clod_stream_cached_pages"] = 1;
  values["live_clod_stream_build_budget"] = 1;
  values["live_clod_stream_max_inflight_batches"] = 4;
  values["live_clod_stream_radius_m"] = 768;
  values["live_clod_stream_ready_pages"] = 1;
  values["live_clod_stream_active_root_pages"] = 1;
  values["live_clod_stream_max_cached_pages"] = 512;
  values["live_clod_stream_safety_cache_capacity_ok"] = 1;
  values["live_clod_stream_safety_required_pages"] = 1;
  values["live_clod_stream_safety_ready_pages"] = 1;
  values["live_clod_stream_apply_ms"] = 1;
  values["far_clipmap_enabled"] = 1;
  values["far_clipmap_visible"] = 1;
  values["far_clipmap_active_rings"] = 5;
  values["far_clipmap_ready_tiles"] = 5;
  values["far_clipmap_pending_tiles"] = 0;
  values["far_clipmap_rebuilt_this_frame"] = 0;
  values["far_clipmap_inner_radius_m"] = 384;
  values["far_clipmap_outer_radius_m"] = 4096;
  values["far_clipmap_gpu_owned_cells"] = 5;
  values["far_clipmap_gpu_ownership_holes"] = 0;
  values["far_clipmap_owned_cells"] = 64;
  values["far_clipmap_unowned_cells"] = 0;
  values["far_clipmap_ownership_holes"] = 0;
  values["far_clipmap_priority_overlap_cells"] = 8;
  values["owner_far_clipmap_cells"] = 48;
  values["owner_clod_refinement_cells"] = 16;
  values["owner_live_cells"] = 4;
  values["vegetation_ring_unbounded"] = 1;
  values["vegetation_ring_distance_to_grass_m"] = 0;
  values["infinite_hydrology_outside_sample_valid"] = 1;
  values["infinite_hydrology_nonrepeat_delta"] = 1;
  values["infinite_hydrology_nonrepeat_ok"] = 1;
  values["infinite_hydrology_camera_outside_startup"] = 1;
  return { ...values, ...overrides };
}

describe("infinite islands threshold validation", () => {
  it("passes the valid acceptance counter set", () => {
    expect(evaluateThresholds(validCounters()).passed).toBe(true);
  });

  it("fails when a required counter is missing", () => {
    const values = validCounters();
    delete values["frame_ms_p95"];
    const result = evaluateThresholds(values);
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.includes("frame_ms_p95 missing"))).toBe(true);
  });

  it("fails when p95 is non-finite, negative, or above budget", () => {
    expect(evaluateThresholds(validCounters({ frame_ms_p95: Infinity })).passed).toBe(false);
    expect(evaluateThresholds(validCounters({ frame_ms_p95: -1 })).passed).toBe(false);
    expect(evaluateThresholds(validCounters({ frame_ms_p95: 9 })).passed).toBe(false);
  });

  it("fails when ownership, overlap, gap, or horizon counters are non-zero", () => {
    for (const key of [
      "ring_boundary_holes",
      "live_clod_gap_holes",
      "clod_far_gap_holes",
      "live_clod_overlap_cells",
      "clod_far_overlap_cells",
      "horizon_hole_ratio",
    ]) {
      expect(evaluateThresholds(validCounters({ [key]: 1 })).passed).toBe(false);
    }
  });

  it("fails when far clipmap ownership is not ready", () => {
    expect(evaluateThresholds(validCounters({
      far_clipmap_ready_tiles: 4,
      far_clipmap_pending_tiles: 1,
      far_clipmap_ownership_holes: 1,
    })).passed).toBe(false);
  });

  it("fails when required streamed roots never become ready residents", () => {
    expect(evaluateThresholds(validCounters({
      live_clod_stream_ready_pages: 0,
      live_clod_stream_active_root_pages: 0,
    })).passed).toBe(false);
  });

  it("does not let cached roots alone satisfy readiness", () => {
    expect(evaluateThresholds(validCounters({
      live_clod_stream_cached_pages: 1,
      live_clod_stream_ready_pages: 0,
      live_clod_stream_active_root_pages: 0,
    })).failures).not.toContain(
      "live_clod_stream_cached_pages=1 failed: must be finite and >= ready roots",
    );
    expect(evaluateThresholds(validCounters({
      live_clod_stream_ready_pages: 0,
      live_clod_stream_active_root_pages: 0,
      live_clod_stream_required_pages: 0,
    })).failures).not.toContain(
      "live_clod_stream_ready_pages=0 failed: must be > 0 when worker stream roots are required and enabled",
    );
  });

  it("fails when streamed root apply work exceeds the main-thread budget", () => {
    expect(evaluateThresholds(validCounters({ live_clod_stream_apply_ms: 2.01 })).passed).toBe(false);
  });

  it("fails when the streamed CLOD radius is smaller than the ownership CLOD radius", () => {
    expect(evaluateThresholds(validCounters({ live_clod_stream_radius_m: 96 })).passed).toBe(false);
  });

  it("fails when the streamed CLOD safety set cannot fit cache", () => {
    expect(evaluateThresholds(validCounters({ live_clod_stream_safety_cache_capacity_ok: 0 })).passed).toBe(false);
  });

  it("fails when vegetation is still clamped to the startup grid", () => {
    expect(evaluateThresholds(validCounters({ vegetation_ring_unbounded: 0 })).passed).toBe(false);
    expect(evaluateThresholds(validCounters({ vegetation_ring_distance_to_grass_m: 8 })).passed).toBe(false);
  });
});
