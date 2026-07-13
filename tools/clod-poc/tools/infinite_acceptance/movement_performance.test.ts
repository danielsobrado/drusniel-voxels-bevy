import { describe, expect, it } from "vitest";
import { evaluateMovementPerformance } from "./movement_performance.js";

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
