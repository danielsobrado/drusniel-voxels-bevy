import { describe, expect, it } from "vitest";
import { evaluateThresholds, REQUIRED_COUNTERS } from "./thresholds.js";

function validCounters(overrides: Record<string, number> = {}): Record<string, number> {
  const values = Object.fromEntries(REQUIRED_COUNTERS.map((key) => [key, 0]));
  values["frame_ms_p95"] = 8;
  values["frame_ms_p99"] = 9;
  values["far_shell_inner_minus_clod_radius_m"] = 1;
  values["streamer_far_shell_ownership_ok"] = 1;
  values["live_bubble_required_pages"] = 1;
  values["live_bubble_ready_pages"] = 1;
  values["live_bubble_streamed_collider_pages"] = 1;
  values["live_bubble_collider_registrations"] = 1;
  values["live_clod_stream_required_pages"] = 1;
  values["live_clod_stream_cached_pages"] = 1;
  values["live_clod_stream_build_budget"] = 1;
  values["live_clod_stream_apply_ms"] = 1;
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

  it("fails when required streamed roots never become cached", () => {
    expect(evaluateThresholds(validCounters({ live_clod_stream_cached_pages: 0 })).passed).toBe(false);
  });

  it("allows zero cached roots only when builds are disabled or no pages are required", () => {
    expect(evaluateThresholds(validCounters({
      live_clod_stream_cached_pages: 0,
      live_clod_stream_build_budget: 0,
    })).failures).not.toContain(
      "live_clod_stream_cached_pages=0 failed: must be > 0 when worker stream roots are required and enabled",
    );
    expect(evaluateThresholds(validCounters({
      live_clod_stream_cached_pages: 0,
      live_clod_stream_required_pages: 0,
    })).failures).not.toContain(
      "live_clod_stream_cached_pages=0 failed: must be > 0 when worker stream roots are required and enabled",
    );
  });

  it("fails when streamed root apply work exceeds the main-thread budget", () => {
    expect(evaluateThresholds(validCounters({ live_clod_stream_apply_ms: 2.01 })).passed).toBe(false);
  });
});
