import { describe, expect, it } from "vitest";
import { evaluateThresholds, REQUIRED_COUNTERS } from "./thresholds.js";

function validCounters(overrides: Record<string, number> = {}): Record<string, number> {
  const values: Record<string, number> = {};
  for (const key of REQUIRED_COUNTERS) values[key] = 1;
  values["frame_ms_p95"] = 8;
  values["frame_ms_p99"] = 9;
  values["ring_boundary_holes"] = 0;
  values["live_clod_gap_holes"] = 0;
  values["clod_far_gap_holes"] = 0;
  values["live_clod_overlap_cells"] = 0;
  values["clod_far_overlap_cells"] = 0;
  values["priority_owner_overlap_cells"] = 0;
  values["priority_unowned_cells"] = 0;
  values["missing_live_chunks_in_required_radius"] = 0;
  values["missing_clod_pages_in_required_radius"] = 0;
  values["camera_to_clod_center_m"] = 0;
  values["camera_to_far_shell_center_m"] = 0;
  values["far_shell_inner_minus_clod_radius_m"] = 1;
  values["horizon_hole_ratio"] = 0;
  values["far_summary_tiles_missing"] = 0;
  values["live_bubble_required_pages"] = 1;
  values["live_bubble_ready_pages"] = 1;
  values["live_bubble_failed_pages"] = 0;
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
});
