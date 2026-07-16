import { describe, expect, it } from "vitest";
import { evaluateSoak, type SoakMinuteSample, type SoakThresholds } from "./long_map_soak_analysis.js";

const thresholds: SoakThresholds = {
  warmupMinutes: 1,
  maxHeapHighWaterGrowthBytes: 1_000,
  maxHeapFloorGrowthBytes: 500,
  maxVramHighWaterGrowthBytes: 1_000,
  maxResourceGrowth: 1,
  maxLateFrameP95Ratio: 1.1,
  maxBackgroundRecoveryMs: 5_000,
};

function sample(
  minute: number,
  heap: number,
  heapFloor: number,
  vram: number,
  resident: number,
  frameMsP95 = 10,
  queuesDrained = true,
): SoakMinuteSample {
  return {
    minute,
    usedJsHeapBytes: heap,
    postGcHeapFloorBytes: heapFloor,
    estimatedVramBytes: vram,
    frameMsP95,
    queuesDrained,
    counters: { live_clod_stream_cached_pages: resident },
  };
}

describe("long-map soak analysis", () => {
  it("accepts bounded sawtooth envelopes after warmup", () => {
    const result = evaluateSoak([
      sample(0, 9_000, 1_000, 2_000, 4),
      sample(1, 10_000, 2_000, 3_000, 5),
      sample(2, 10_800, 2_300, 3_800, 6),
      sample(3, 10_200, 2_100, 3_300, 5),
    ], thresholds);

    expect(result.passed).toBe(true);
    expect(result.heap.highWaterGrowth).toBe(800);
    expect(result.heap.floorGrowth).toBe(100);
  });

  it("rejects growing high-water, post-GC floor, VRAM, and resources", () => {
    const result = evaluateSoak([
      sample(1, 1_000, 500, 1_000, 1),
      sample(2, 4_000, 2_000, 4_000, 3),
      sample(3, 7_000, 4_000, 7_000, 5),
    ], thresholds);

    expect(result.passed).toBe(false);
    expect(result.failures).toHaveLength(4);
  });

  it("fails closed when the run never reaches the steady-state window", () => {
    const result = evaluateSoak([sample(0, 1_000, 500, 1_000, 1)], thresholds);

    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain("no steady-state samples");
  });

  it("fails closed when post-GC heap floor evidence is unavailable", () => {
    const noGc = { ...sample(1, 1_000, 0, 1_000, 1), postGcHeapFloorBytes: null };
    const result = evaluateSoak([noGc], thresholds);

    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain("post-GC heap floor evidence unavailable");
  });

  it("requires queues to drain at every settled sample", () => {
    const result = evaluateSoak([
      sample(1, 1_000, 500, 1_000, 1),
      sample(2, 1_000, 500, 1_000, 1, 10, false),
    ], thresholds);

    expect(result.failures).toContain("streaming queues were not drained at minute 2");
  });
});
