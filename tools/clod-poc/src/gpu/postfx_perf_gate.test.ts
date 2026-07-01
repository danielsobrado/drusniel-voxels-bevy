import { describe, expect, it } from "vitest";
import {
  evaluatePostFxPerfGate,
  parsePostFxPerfGateConfig,
  type PostFxPerfSummary,
} from "./postfx_perf_gate.js";

function summary(cases: Array<{ name: string; frameP50: number; frameP95: number; renderP95: number }>): PostFxPerfSummary {
  return {
    cases: cases.map((entry) => ({
      name: entry.name,
      snapshot: {
        metrics: {
          frameMs: { p50: entry.frameP50, p95: entry.frameP95 },
          renderMs: { p95: entry.renderP95 },
        },
      },
    })),
  };
}

describe("postfx perf gate", () => {
  it("parses the yaml config shape", () => {
    const config = parsePostFxPerfGateConfig("postfx_perf_gate:\n  baseline_case: base\n  default_thresholds:\n    max_frame_p50_delta_ms: 1\n    max_frame_p95_delta_ms: 2\n    max_render_p95_delta_ms: 3\n");
    expect(config.baselineCase).toBe("base");
    expect(config.defaultThresholds.maxFrameP50DeltaMs).toBe(1);
    expect(config.defaultThresholds.maxRenderP95DeltaMs).toBe(3);
  });

  it("returns no issues when deltas are inside limits", () => {
    const config = parsePostFxPerfGateConfig("postfx_perf_gate:\n  baseline_case: postfx-off\n  default_thresholds:\n    max_frame_p50_delta_ms: 2\n    max_frame_p95_delta_ms: 3\n    max_render_p95_delta_ms: 4\n");
    const result = evaluatePostFxPerfGate(summary([
      { name: "postfx-off", frameP50: 4, frameP95: 6, renderP95: 2 },
      { name: "postfx-default", frameP50: 5, frameP95: 8, renderP95: 5 },
    ]), config);
    expect(result.failures).toHaveLength(0);
    expect(result.rows[0]?.frameP50DeltaMs).toBe(1);
  });

  it("reports every metric over the limit", () => {
    const config = parsePostFxPerfGateConfig("postfx_perf_gate:\n  baseline_case: postfx-off\n  default_thresholds:\n    max_frame_p50_delta_ms: 1\n    max_frame_p95_delta_ms: 1\n    max_render_p95_delta_ms: 1\n");
    const result = evaluatePostFxPerfGate(summary([
      { name: "postfx-off", frameP50: 4, frameP95: 6, renderP95: 2 },
      { name: "postfx-default", frameP50: 7, frameP95: 8, renderP95: 4 },
    ]), config);
    expect(result.failures.map((entry) => entry.metric)).toEqual(["frameP50", "frameP95", "renderP95"]);
  });
});
