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

function validCounters(): Record<string, number> {
  const counters = Object.fromEntries(REQUIRED_COUNTERS.map((key) => [key, 0]));
  counters["frame_ms_p95"] = 7.9;
  counters["frame_ms_p99"] = 9;
  counters["streamer_far_shell_ownership_ok"] = 1;
  counters["streamer_clod_radius_m"] = 2048;
  counters["live_bubble_required_pages"] = 1;
  counters["live_bubble_ready_pages"] = 1;
  counters["live_bubble_streamed_collider_pages"] = 1;
  counters["live_bubble_collider_registrations"] = 1;
  counters["live_bubble_gpu_dispatch_budget"] = 12;
  counters["live_bubble_max_inflight_chunks"] = 128;
  counters["live_bubble_ready_visual_pages"] = 1;
  counters["live_bubble_visual_required_pages"] = 1;
  counters["live_bubble_visual_ready_pages"] = 1;
  counters["live_bubble_collider_required_pages"] = 1;
  counters["live_bubble_collider_ready_pages"] = 1;
  counters["live_clod_stream_required_pages"] = 1;
  counters["live_clod_stream_cached_pages"] = 1;
  counters["live_clod_stream_build_budget"] = 1;
  counters["live_clod_stream_max_inflight_batches"] = 4;
  counters["live_clod_stream_radius_m"] = 2048;
  counters["live_clod_stream_ready_pages"] = 1;
  counters["live_clod_stream_active_root_pages"] = 1;
  counters["live_clod_stream_max_cached_pages"] = 512;
  counters["live_clod_stream_safety_cache_capacity_ok"] = 1;
  counters["live_clod_stream_safety_required_pages"] = 1;
  counters["live_clod_stream_safety_ready_pages"] = 1;
  counters["live_clod_stream_apply_ms"] = 1;
  counters["vegetation_ring_unbounded"] = 1;
  counters["vegetation_ring_distance_to_grass_m"] = 0;
  counters["infinite_hydrology_outside_sample_valid"] = 1;
  counters["infinite_hydrology_nonrepeat_delta"] = 1;
  counters["infinite_hydrology_nonrepeat_ok"] = 1;
  counters["infinite_hydrology_camera_outside_startup"] = 1;
  return counters;
}

describe("infinite islands thresholds", () => {
  it("passes a valid zero-hole sample", () => {
    expect(evaluateThresholds(validCounters()).passed).toBe(true);
  });

  it("reports missing counters and threshold failures", () => {
    const counters = validCounters();
    delete counters["frame_ms_p99"];
    counters["frame_ms_p95"] = 8.1;
    counters["ring_boundary_holes"] = 1;
    const result = evaluateThresholds(counters);

    expect(result.passed).toBe(false);
    expect(result.missing).toContain("frame_ms_p99");
    expect(result.failures).toContain("frame_ms_p95=8.1 failed: must be finite, >= 0 and <= 8");
    expect(result.failures).toContain("ring_boundary_holes=1 failed: must equal 0");
  });

  it("splits coverage and perf gates so oracle cost does not affect frame timing", () => {
    const coverage = validCounters();
    coverage["frame_ms_p95"] = 30;
    expect(evaluateThresholds(coverage, COVERAGE_REQUIRED_COUNTERS, COVERAGE_RULES).passed).toBe(true);

    const perf = validCounters();
    perf["ring_boundary_holes"] = 7;
    expect(evaluateThresholds(perf, PERF_REQUIRED_COUNTERS, PERF_RULES).passed).toBe(true);

    perf["frame_ms_p95"] = 8.1;
    expect(evaluateThresholds(perf, PERF_REQUIRED_COUNTERS, PERF_RULES).failures).toContain(
      "frame_ms_p95=8.1 failed: must be finite, >= 0 and <= 8",
    );
  });

  it("allows parent-covered CLOD descendants to be missing before stream readiness", () => {
    const counters = validCounters();
    counters["stream_ready_frame"] = -1;
    counters["residency_missing_clod"] = 8;
    counters["missing_clod_pages_in_required_radius"] = 0;
    counters["clod_parent_coverage_violations"] = 0;
    expect(evaluateThresholds(counters, COVERAGE_REQUIRED_COUNTERS, COVERAGE_RULES).failures).toContain(
      "stream_ready_frame=-1 failed: must be finite and >= 0",
    );

    counters["stream_ready_frame"] = 42;
    expect(evaluateThresholds(counters, COVERAGE_REQUIRED_COUNTERS, COVERAGE_RULES).failures).toContain(
      "residency_missing_clod=8 failed: must equal 0, or be parent-covered before stream_ready_frame",
    );
  });

  it("checks streamed live collider pages", () => {
    const counters = validCounters();
    counters["live_bubble_streamed_collider_pages"] = 0;

    expect(evaluateThresholds(counters).failures).toContain(
      "live_bubble_streamed_collider_pages=0 failed: must be > 0",
    );
  });

  it("requires ready resident CLOD root pages when pages are required", () => {
    const counters = validCounters();
    counters["live_clod_stream_ready_pages"] = 0;
    counters["live_clod_stream_active_root_pages"] = 0;
    expect(evaluateThresholds(counters).failures).toContain(
      "live_clod_stream_ready_pages=0 failed: must be > 0 when worker stream roots are required and enabled",
    );

    counters["live_clod_stream_cached_pages"] = 1;
    expect(evaluateThresholds(counters).passed).toBe(false);

    counters["live_clod_stream_required_pages"] = 0;
    expect(evaluateThresholds(counters).failures).toContain(
      "live_clod_stream_required_pages=0 failed: must be > 0",
    );
  });

  it("allows refinement work to remain pending after safety coverage is ready", () => {
    const counters = validCounters();
    counters["live_clod_stream_apply_queue_pages"] = 3;
    counters["live_clod_stream_refinement_pending_pages"] = 8;
    counters["live_clod_stream_refinement_inflight_pages"] = 4;

    expect(evaluateThresholds(counters).passed).toBe(true);
  });

  it("requires safety parent coverage before passing", () => {
    const counters = validCounters();
    counters["live_clod_stream_safety_ready_pages"] = 0;
    counters["live_clod_stream_safety_pending_pages"] = 1;
    counters["live_clod_stream_parent_coverage_violations"] = 1;

    expect(evaluateThresholds(counters).failures).toContain(
      "live_clod_stream_parent_coverage_violations=1 failed: must equal 0",
    );
  });

  it("fails when the streamed CLOD safety set cannot fit cache", () => {
    const counters = validCounters();
    counters["live_clod_stream_safety_cache_capacity_ok"] = 0;
    counters["live_clod_stream_safety_required_pages"] = 513;

    expect(evaluateThresholds(counters).failures).toContain(
      "live_clod_stream_safety_cache_capacity_ok=0 failed: must equal 1 when streamed roots are required",
    );
    expect(evaluateThresholds(counters).failures).toContain(
      "live_clod_stream_safety_required_pages=513 failed: must be <= live_clod_stream_max_cached_pages",
    );
  });

  it("requires the live CLOD stream radius to cover the ownership CLOD radius", () => {
    const counters = validCounters();
    counters["live_clod_stream_radius_m"] = 96;

    expect(evaluateThresholds(counters).failures).toContain(
      "live_clod_stream_radius_m=96 failed: must be >= streamer_clod_radius_m",
    );
  });

  it("checks streamed root apply cost", () => {
    const counters = validCounters();
    counters["live_clod_stream_apply_ms"] = 2.1;

    expect(evaluateThresholds(counters).failures).toContain(
      "live_clod_stream_apply_ms=2.1 failed: must be finite, >= 0 and <= 2",
    );
  });

  it("checks unbounded vegetation ring behavior", () => {
    const counters = validCounters();
    counters["vegetation_ring_unbounded"] = 0;
    counters["vegetation_ring_distance_to_grass_m"] = 32;

    expect(evaluateThresholds(counters).failures).toContain(
      "vegetation_ring_unbounded=0 failed: must equal 1 for infinite-islands",
    );
    expect(evaluateThresholds(counters).failures).toContain(
      "vegetation_ring_distance_to_grass_m=32 failed: must equal 0 for unbounded vegetation rings",
    );
  });

  it("checks non-repeating infinite hydrology samples", () => {
    const counters = validCounters();
    counters["infinite_hydrology_nonrepeat_ok"] = 0;

    expect(evaluateThresholds(counters).failures).toContain(
      "infinite_hydrology_nonrepeat_ok=0 failed: must equal 1",
    );
  });

  it("extracts counters from stats.counters", () => {
    const counters = validCounters();

    expect(extractAcceptanceCounters({ counters })["live_bubble_collider_registrations"]).toBe(1);
    expect(extractAcceptanceCounters({ counters })["live_clod_stream_cached_pages"]).toBe(1);
    expect(extractAcceptanceCounters({ counters })["live_clod_stream_worker_transfer_bytes"]).toBe(0);
    expect(extractAcceptanceCounters({ counters })["vegetation_ring_unbounded"]).toBe(1);
    expect(extractAcceptanceCounters({ counters })["infinite_hydrology_nonrepeat_ok"]).toBe(1);
  });
});
