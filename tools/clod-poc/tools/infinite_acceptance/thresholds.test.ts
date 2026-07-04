import { describe, expect, it } from "vitest";
import { evaluateThresholds, extractAcceptanceCounters, REQUIRED_COUNTERS } from "./thresholds.js";

function validCounters(): Record<string, number> {
  const counters = Object.fromEntries(REQUIRED_COUNTERS.map((key) => [key, 0]));
  counters["frame_ms_p95"] = 7.9;
  counters["frame_ms_p99"] = 9;
  counters["streamer_far_shell_ownership_ok"] = 1;
  counters["live_bubble_required_pages"] = 1;
  counters["live_bubble_ready_pages"] = 1;
  counters["live_bubble_streamed_collider_pages"] = 1;
  counters["live_bubble_collider_registrations"] = 1;
  counters["live_clod_stream_required_pages"] = 1;
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

  it("checks streamed live collider pages", () => {
    const counters = validCounters();
    counters["live_bubble_streamed_collider_pages"] = 0;

    expect(evaluateThresholds(counters).failures).toContain(
      "live_bubble_streamed_collider_pages=0 failed: must be > 0",
    );
  });

  it("checks outside-startup CLOD root page requests without requiring cached root builds", () => {
    const counters = validCounters();
    counters["live_clod_stream_required_pages"] = 0;
    expect(evaluateThresholds(counters).failures).toContain(
      "live_clod_stream_required_pages=0 failed: must be > 0",
    );

    counters["live_clod_stream_required_pages"] = 1;
    counters["live_clod_stream_cached_pages"] = 0;
    expect(evaluateThresholds(counters).passed).toBe(true);
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
    expect(extractAcceptanceCounters({ counters })["live_clod_stream_cached_pages"]).toBe(0);
    expect(extractAcceptanceCounters({ counters })["infinite_hydrology_nonrepeat_ok"]).toBe(1);
  });
});
