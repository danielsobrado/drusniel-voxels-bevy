import { describe, expect, it } from "vitest";
import { evaluateContinentRouteTails, type ContinentRouteTailThresholds } from "./continent_route_thresholds.js";

const thresholds: ContinentRouteTailThresholds = {
  maxFrameP50Ms: 10,
  maxFrameP95Ms: 12,
  maxFrameP99Ms: 17,
  maxFrameP999Ms: 25,
  maxFrameMs: 30,
  maxFramesOver16_7Ms: 20,
  maxFramesOver33_3Ms: 0,
  maxLongTaskCount: 0,
  maxLongestLongTaskMs: 0,
  maxTopPhaseP95Ms: 8,
  maxTopPhaseMs: 20,
};

describe("continent route tail thresholds", () => {
  it("evaluates percentiles, catastrophic frames, threshold buckets, long tasks, and phase maxima", () => {
    const failures = evaluateContinentRouteTails({
      frameP50Ms: 9,
      frameP95Ms: 11,
      frameP99Ms: 16,
      frameP999Ms: 24,
      maxFrameMs: 31,
      framesOver16_7Ms: 21,
      framesOver33_3Ms: 1,
      longTaskCount: 1,
      longestLongTaskMs: 51,
      topPhaseP95Ms: 7,
      topPhaseMaxMs: 21,
    }, thresholds);

    expect(failures).toEqual([
      "max frame 31.000 > 30.000",
      "frames >16.7ms 21.000 > 20.000",
      "frames >33.3ms 1.000 > 0.000",
      "long-task count 1.000 > 0.000",
      "longest long task 51.000 > 0.000",
      "top phase max 21.000 > 20.000",
    ]);
  });
});
