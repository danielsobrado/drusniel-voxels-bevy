import { describe, expect, it } from "vitest";
import { evaluateRepeatability, type RepeatabilityRun } from "./long_map_repeatability_analysis.js";

function run(id: string, p95: number, freshProfile = false): RepeatabilityRun {
  return {
    id,
    passed: true,
    freshProfile,
    environmentKey: "same-env",
    metrics: {
      frameP50Ms: 8,
      frameP95Ms: p95,
      frameP99Ms: 16,
      frameP999Ms: 22,
      maxFrameMs: 25,
      framesOver16_7Ms: 4,
      framesOver33_3Ms: 0,
      framesOver100Ms: 0,
      longTaskCount: 0,
      longestLongTaskMs: 0,
    },
  };
}

describe("long-map repeatability", () => {
  it("requires five same-environment proof runs plus one fresh-profile run", () => {
    const evaluation = evaluateRepeatability([
      run("r1", 10), run("r2", 12), run("r3", 11), run("r4", 13), run("r5", 9), run("fresh", 12, true),
    ]);
    expect(evaluation.passed).toBe(true);
    expect(evaluation.metrics.frameP95Ms).toEqual({ median: 11, worst: 13, spread: 4 });
  });

  it("fails for environment drift or a red source report", () => {
    const runs = [run("r1", 10), run("r2", 10), run("r3", 10), run("r4", 10), run("r5", 10), run("fresh", 10, true)];
    runs[1]!.environmentKey = "other-env";
    runs[2]!.passed = false;
    const evaluation = evaluateRepeatability(runs);
    expect(evaluation.failures).toContain("repeated runs used 2 different environments");
    expect(evaluation.failures).toContain("r3: source report did not pass");
  });
});
