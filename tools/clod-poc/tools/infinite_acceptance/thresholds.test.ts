import { describe, expect, it } from "vitest";
import {
  COVERAGE_REQUIRED_COUNTERS,
  COVERAGE_RULES,
  evaluateThresholds,
  extractAcceptanceCounters,
  PERF_REQUIRED_COUNTERS,
  PERF_RULES,
  REQUIRED_COUNTERS,
} from "./thresholds.js";

function validCounters(overrides: Record<string, number> = {}): Record<string, number> {
  const counters = Object.fromEntries(REQUIRED_COUNTERS.map((key) => [key, 0]));
  Object.assign(counters, {
    world_manifest_present: 1,
    frame_ms_p95: 7.9,
    frame_ms_p99: 9,
    target_visible_m: 4096,
    streamer_far_shell_ownership_ok: 1,
    streamer_live_radius_m: 200,
    streamer_clod_radius_m: 768,
    far_shell_inner_minus_clod_radius_m: -384,
    live_bubble_required_pages: 1,
    live_bubble_ready_pages: 1,
    live_bubble_streamed_collider_pages: 1,
    live_bubble_collider_registrations: 1,
    live_bubble_gpu_dispatch_budget: 12,
    live_bubble_max_inflight_chunks: 128,
    live_bubble_ready_visual_pages: 1,
    live_bubble_visual_required_pages: 1,
    live_bubble_visual_ready_pages: 1,
    live_bubble_collider_required_pages: 1,
    live_bubble_collider_ready_pages: 1,
    live_clod_stream_required_pages: 1,
    live_clod_stream_cached_pages: 1,
    live_clod_stream_build_budget: 1,
    live_clod_stream_max_inflight_batches: 4,
    live_clod_stream_radius_m: 768,
    live_clod_stream_ready_pages: 1,
    live_clod_stream_active_root_pages: 1,
    live_clod_stream_max_cached_pages: 512,
    live_clod_stream_safety_cache_capacity_ok: 1,
    live_clod_stream_safety_required_pages: 1,
    live_clod_stream_safety_ready_pages: 1,
    live_clod_stream_apply_ms: 1,
    live_clod_stream_cache_backend_gpu: 1,
    live_clod_stream_cache_nodes_from_cache: 0,
    live_clod_stream_gpu_mesher_enabled: 1,
    live_clod_stream_gpu_batches_dispatched: 1,
    live_clod_stream_gpu_pages_dispatched: 4,
    live_clod_stream_gpu_chunk_slots_dispatched: 64,
    live_clod_stream_gpu_failed_batches: 0,
    live_clod_stream_worker_fallback_pages: 0,
    live_clod_stream_bounds_guard_enabled: 1,
    live_clod_stream_bounds_guard_checked_pages: 1,
    far_clipmap_enabled: 1,
    far_clipmap_visible: 1,
    far_clipmap_active_rings: 5,
    far_clipmap_ready_tiles: 5,
    far_clipmap_pending_tiles: 0,
    far_clipmap_rebuilt_this_frame: 0,
    far_clipmap_source_ready: 1,
    far_clipmap_build_ms: 0,
    far_clipmap_build_ms_total: 1,
    far_clipmap_vertices_built_this_frame: 0,
    far_clipmap_triangles_built_this_frame: 0,
    far_clipmap_fallback_samples_this_frame: 0,
    far_clipmap_fallback_samples_total: 0,
    far_clipmap_exception_samples_this_frame: 0,
    far_clipmap_exception_samples_total: 0,
    far_clipmap_inner_radius_m: 384,
    far_clipmap_outer_radius_m: 4096,
    far_clipmap_gpu_owned_cells: 5,
    far_clipmap_gpu_ownership_holes: 0,
    far_clipmap_owned_cells: 64,
    far_clipmap_unowned_cells: 0,
    far_clipmap_ownership_holes: 0,
    far_clipmap_priority_overlap_cells: 8,
    owner_far_clipmap_cells: 48,
    owner_clod_refinement_cells: 16,
    owner_live_cells: 4,
    vegetation_ring_unbounded: 1,
    vegetation_ring_distance_to_grass_m: 0,
    infinite_hydrology_outside_sample_valid: 1,
    infinite_hydrology_nonrepeat_delta: 1,
    infinite_hydrology_nonrepeat_ok: 1,
    infinite_hydrology_camera_outside_startup: 1,
    ...overrides,
  });
  return counters;
}

describe("infinite islands thresholds", () => {
  it("passes a valid zero-hole sample", () => {
    expect(evaluateThresholds(validCounters()).passed).toBe(true);
  });

  it("requires a world manifest", () => {
    expect(evaluateThresholds(validCounters({ world_manifest_present: 1 })).passed).toBe(true);
    expect(evaluateThresholds(validCounters({ world_manifest_present: 0 })).failures).toContain(
      "world_manifest_present=0 failed: must equal 1",
    );
  });

  it("reports missing counters and threshold failures", () => {
    const counters = validCounters({ frame_ms_p95: 8.1, ring_boundary_holes: 1 });
    delete counters["frame_ms_p99"];
    const result = evaluateThresholds(counters);

    expect(result.passed).toBe(false);
    expect(result.missing).toContain("frame_ms_p99");
    expect(result.failures).toContain("frame_ms_p95=8.1 failed: must be finite, >= 0 and <= 8");
    expect(result.failures).toContain("ring_boundary_holes=1 failed: must equal 0");
  });

  it("splits coverage and perf gates so oracle cost does not affect frame timing", () => {
    expect(evaluateThresholds(validCounters({ frame_ms_p95: 30 }), COVERAGE_REQUIRED_COUNTERS, COVERAGE_RULES).passed).toBe(true);
    expect(evaluateThresholds(validCounters({ ring_boundary_holes: 7 }), PERF_REQUIRED_COUNTERS, PERF_RULES).passed).toBe(true);
    expect(evaluateThresholds(validCounters({ frame_ms_p95: 8.1 }), PERF_REQUIRED_COUNTERS, PERF_RULES).failures).toContain(
      "frame_ms_p95=8.1 failed: must be finite, >= 0 and <= 8",
    );
  });

  it("allows parent-covered CLOD descendants to be missing before stream readiness", () => {
    const preReady = validCounters({
      stream_ready_frame: -1,
      residency_missing_clod: 8,
      missing_clod_pages_in_required_radius: 0,
      clod_parent_coverage_violations: 0,
    });
    expect(evaluateThresholds(preReady, COVERAGE_REQUIRED_COUNTERS, COVERAGE_RULES).failures).toContain(
      "stream_ready_frame=-1 failed: must be finite and >= 0",
    );

    const ready = validCounters({ residency_missing_clod: 8, stream_ready_frame: 42 });
    expect(evaluateThresholds(ready, COVERAGE_REQUIRED_COUNTERS, COVERAGE_RULES).failures).toContain(
      "residency_missing_clod=8 failed: must equal 0, or be parent-covered before stream_ready_frame",
    );
  });

  it("checks live bubble and streamed CLOD safety failures", () => {
    expect(evaluateThresholds(validCounters({ live_bubble_streamed_collider_pages: 0 })).failures).toContain(
      "live_bubble_streamed_collider_pages=0 failed: must be > 0",
    );
    expect(evaluateThresholds(validCounters({ live_clod_stream_ready_pages: 0, live_clod_stream_active_root_pages: 0 })).failures).toContain(
      "live_clod_stream_ready_pages=0 failed: must be > 0 when worker stream roots are required and enabled",
    );
    expect(evaluateThresholds(validCounters({ live_clod_stream_safety_cache_capacity_ok: 0 })).failures).toContain(
      "live_clod_stream_safety_cache_capacity_ok=0 failed: must equal 1 when streamed roots are required",
    );
    expect(evaluateThresholds(validCounters({ live_clod_stream_radius_m: 96 })).failures).toContain(
      "live_clod_stream_radius_m=96 failed: must be >= streamer_clod_radius_m",
    );
  });

  it("fails unless streamed-root GPU work dispatched or came from GPU cache without fallback", () => {
    expect(evaluateThresholds(validCounters({ live_clod_stream_gpu_mesher_enabled: 0 })).failures).toContain(
      "live_clod_stream_gpu_mesher_enabled=0 failed: must equal 1",
    );
    expect(evaluateThresholds(validCounters({ live_clod_stream_gpu_batches_dispatched: 0 })).failures).toContain(
      "live_clod_stream_gpu_batches_dispatched=0 failed: must dispatch GPU batches or reuse GPU stream-root cache",
    );
    expect(evaluateThresholds(validCounters({ live_clod_stream_gpu_chunk_slots_dispatched: 4 })).failures).toContain(
      "live_clod_stream_gpu_chunk_slots_dispatched=4 failed: must exceed pages dispatched or reuse GPU stream-root cache",
    );
    expect(evaluateThresholds(validCounters({ live_clod_stream_gpu_failed_batches: 1 })).failures).toContain(
      "live_clod_stream_gpu_failed_batches=1 failed: must equal 0",
    );
    expect(evaluateThresholds(validCounters({ live_clod_stream_worker_fallback_pages: 1 })).failures).toContain(
      "live_clod_stream_worker_fallback_pages=1 failed: must equal 0",
    );
  });

  it("allows GPU-backed stream-root cache reuse without fresh dispatch", () => {
    expect(evaluateThresholds(validCounters({
      live_clod_stream_cache_backend_gpu: 1,
      live_clod_stream_cache_nodes_from_cache: 4,
      live_clod_stream_gpu_batches_dispatched: 0,
      live_clod_stream_gpu_pages_dispatched: 0,
      live_clod_stream_gpu_chunk_slots_dispatched: 0,
    })).passed).toBe(true);
  });

  it("allows refinement work to remain pending after safety coverage is ready", () => {
    expect(evaluateThresholds(validCounters({
      live_clod_stream_apply_queue_pages: 3,
      live_clod_stream_refinement_pending_pages: 8,
      live_clod_stream_refinement_inflight_pages: 4,
    })).passed).toBe(true);
  });

  it("requires ready far clipmap ownership before passing", () => {
    const result = evaluateThresholds(validCounters({
      far_clipmap_ready_tiles: 4,
      far_clipmap_pending_tiles: 1,
      far_clipmap_ownership_holes: 2,
    }));

    expect(result.failures).toContain("far_clipmap_ready_tiles=4 failed: must cover active rings");
    expect(result.failures).toContain("far_clipmap_pending_tiles=1 failed: must equal 0");
    expect(result.failures).toContain("far_clipmap_ownership_holes=2 failed: must equal 0");
  });

  it("requires clean far clipmap source and build diagnostics", () => {
    expect(evaluateThresholds(validCounters({ far_clipmap_source_ready: 0 })).failures).toContain(
      "far_clipmap_source_ready=0 failed: must equal 1",
    );
    expect(evaluateThresholds(validCounters({ far_clipmap_build_ms: 6.1 })).failures).toContain(
      "far_clipmap_build_ms=6.1 failed: must be finite, >= 0 and <= 6",
    );
    expect(evaluateThresholds(validCounters({ far_clipmap_fallback_samples_total: 1 })).failures).toContain(
      "far_clipmap_fallback_samples_total=1 failed: must equal 0",
    );
    expect(evaluateThresholds(validCounters({ far_clipmap_exception_samples_total: 1 })).failures).toContain(
      "far_clipmap_exception_samples_total=1 failed: must equal 0",
    );
  });

  it("allows far clipmap to overlap CLOD when ownership priority is resolved", () => {
    expect(evaluateThresholds(validCounters({ far_shell_inner_minus_clod_radius_m: -384, far_clipmap_priority_overlap_cells: 12 })).passed).toBe(true);
  });

  it("checks remaining acceptance guardrails", () => {
    expect(evaluateThresholds(validCounters({ live_clod_stream_apply_ms: 2.1 })).failures).toContain(
      "live_clod_stream_apply_ms=2.1 failed: must be finite, >= 0 and <= 2",
    );
    expect(evaluateThresholds(validCounters({ vegetation_ring_unbounded: 0 })).failures).toContain(
      "vegetation_ring_unbounded=0 failed: must equal 1 for infinite-islands",
    );
    expect(evaluateThresholds(validCounters({ vegetation_ring_distance_to_grass_m: 32 })).failures).toContain(
      "vegetation_ring_distance_to_grass_m=32 failed: must equal 0 for unbounded vegetation rings",
    );
    expect(evaluateThresholds(validCounters({ infinite_hydrology_nonrepeat_ok: 0 })).failures).toContain(
      "infinite_hydrology_nonrepeat_ok=0 failed: must equal 1",
    );
  });

  it("extracts counters from stats.counters", () => {
    const counters = validCounters();

    expect(extractAcceptanceCounters({ counters })["world_manifest_present"]).toBe(1);
    expect(extractAcceptanceCounters({ counters })["live_bubble_collider_registrations"]).toBe(1);
    expect(extractAcceptanceCounters({ counters })["live_clod_stream_cached_pages"]).toBe(1);
    expect(extractAcceptanceCounters({ counters })["live_clod_stream_worker_transfer_bytes"]).toBe(0);
    expect(extractAcceptanceCounters({ counters })["live_clod_stream_cache_backend_gpu"]).toBe(1);
    expect(extractAcceptanceCounters({ counters })["live_clod_stream_cache_nodes_from_cache"]).toBe(0);
    expect(extractAcceptanceCounters({ counters })["live_clod_stream_gpu_batches_dispatched"]).toBe(1);
    expect(extractAcceptanceCounters({ counters })["live_clod_stream_worker_fallback_pages"]).toBe(0);
    expect(extractAcceptanceCounters({ counters })["far_clipmap_owned_cells"]).toBe(64);
    expect(extractAcceptanceCounters({ counters })["far_clipmap_source_ready"]).toBe(1);
    expect(extractAcceptanceCounters({ counters })["vegetation_ring_unbounded"]).toBe(1);
    expect(extractAcceptanceCounters({ counters })["infinite_hydrology_nonrepeat_ok"]).toBe(1);
  });
});
