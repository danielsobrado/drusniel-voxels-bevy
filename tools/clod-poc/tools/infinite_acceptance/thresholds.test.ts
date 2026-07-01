import { describe, expect, it } from "vitest";
import { evaluateThresholds, REQUIRED_COUNTERS } from "./thresholds.js";

function validCounters(): Record<string, number> {
  return Object.fromEntries(REQUIRED_COUNTERS.map((key) => [key, 0]));
}

describe("infinite islands thresholds", () => {
  it("passes a complete zero-hole sample under the p95 budget", () => {
    const counters = validCounters();
    counters["frame_ms_p95"] = 7.9;
    counters["frame_ms_p99"] = 9;
    counters["streamer_far_shell_ownership_ok"] = 1;
    expect(evaluateThresholds(counters).passed).toBe(true);
  });

  it("reports missing counters and threshold failures", () => {
    const counters = validCounters();
    delete counters["frame_ms_p99"];
    counters["frame_ms_p95"] = 8.1;
    counters["ring_boundary_holes"] = 1;
    counters["priority_unowned_cells"] = 2;
    const result = evaluateThresholds(counters);
    expect(result.passed).toBe(false);
    expect(result.missing).toContain("frame_ms_p99");
    expect(result.failures).toContain("frame_ms_p95=8.1 failed: must be finite, >= 0 and <= 8");
    expect(result.failures).toContain("ring_boundary_holes=1 failed: must equal 0");
    expect(result.failures).toContain("priority_unowned_cells=2 failed: must equal 0");
  });

  it("rejects non-finite p95 values passed directly to threshold evaluation", () => {
    const counters = validCounters();
    counters["frame_ms_p95"] = Infinity;
    counters["streamer_far_shell_ownership_ok"] = 1;

    const result = evaluateThresholds(counters);

    expect(result.passed).toBe(false);
    expect(result.failures).toContain("frame_ms_p95=Infinity failed: must be finite, >= 0 and <= 8");
  });
});
