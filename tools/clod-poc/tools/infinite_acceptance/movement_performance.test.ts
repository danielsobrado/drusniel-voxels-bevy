import { describe, expect, it } from "vitest";
import { evaluateMovementCoverage, evaluateMovementPerformance } from "./movement_performance.js";

const limits = { minFrameSamples: 460, maxFrameP99Ms: 100, maxFrameMs: 1500, maxWorkUnitMs: 8 };

describe("moving infinite-islands performance gates", () => {
  it("passes complete evidence inside every tail-latency limit", () => {
    expect(evaluateMovementPerformance("walk", {
      frameSampleCount: 524,
      frameP99Ms: 69.5,
      maxFrameMs: 90.2,
      maxWorkUnitMs: 1.4,
    }, limits)).toEqual([]);
  });

  it("fails missing samples, p99, max-frame, and uninterrupted work independently", () => {
    const failures = evaluateMovementPerformance("walk", {
      frameSampleCount: 100,
      frameP99Ms: 101,
      maxFrameMs: 1501,
      maxWorkUnitMs: 8.1,
    }, limits);

    expect(failures).toHaveLength(4);
    expect(failures.join("\n")).toContain("frame p99");
    expect(failures.join("\n")).toContain("max frame");
    expect(failures.join("\n")).toContain("uninterrupted work unit");
  });
});

describe("moving infinite-islands seam coverage gates", () => {
  it("accepts a fully owned route at the calibrated frontier lag bound", () => {
    expect(evaluateMovementCoverage("walk", {
      maxPriorityUnownedCells: 0,
      maxClodFarGapHoles: 0,
      maxFarClipmapOwnershipHoles: 0,
      frontierLagSampleCount: 17,
      frontierLagP95M: 384,
    }, { minFrontierLagSamples: 17, maxFrontierLagP95M: 384 })).toEqual([]);
  });

  it("rejects route-time holes, missing frontier evidence, and excess frontier lag", () => {
    const failures = evaluateMovementCoverage("walk", {
      maxPriorityUnownedCells: 2,
      maxClodFarGapHoles: 3,
      maxFarClipmapOwnershipHoles: 4,
      frontierLagSampleCount: 1,
      frontierLagP95M: 385,
    }, { minFrontierLagSamples: 17, maxFrontierLagP95M: 384 });

    expect(failures).toHaveLength(5);
    expect(failures.join("\n")).toContain("priority-unowned");
    expect(failures.join("\n")).toContain("frontier lag p95");
  });
});
