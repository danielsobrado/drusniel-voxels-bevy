import { describe, expect, it } from "vitest";
import { withSampledPerfCounters } from "./sampled_perf_counters.js";

describe("withSampledPerfCounters", () => {
  it("uses the controlled perf-probe window for the settled p95 gate", () => {
    expect(withSampledPerfCounters(
      { frame_ms_p95: 12.9, frame_ms_p99: 14.5 },
      { report: { metrics: { "framePerf.p95.frameMs": 9.9 } } },
    )).toEqual({ frame_ms_p95: 9.9, frame_ms_p99: 14.5 });
  });

  it("keeps the legacy counter when sampled evidence is unavailable", () => {
    expect(withSampledPerfCounters({ frame_ms_p95: 8.2 }, { available: false }))
      .toEqual({ frame_ms_p95: 8.2 });
    expect(withSampledPerfCounters(
      { frame_ms_p95: 8.2 },
      { report: { metrics: { "framePerf.p95.frameMs": Number.NaN } } },
    )).toEqual({ frame_ms_p95: 8.2 });
  });
});
