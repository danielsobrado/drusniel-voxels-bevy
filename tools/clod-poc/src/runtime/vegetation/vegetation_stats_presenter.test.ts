import { describe, expect, it } from "vitest";
import { createEmptyTreeSystemStats, type TreeStats } from "../../trees/index.js";
import { formatTreeGpuSummary } from "./vegetation_stats_presenter.js";

function stats(overrides: Partial<TreeStats> = {}): TreeStats {
  return { ...createEmptyTreeSystemStats(), ...overrides };
}

describe("vegetation stats presenter", () => {
  it("shows CPU patch path for disabled GPU status", () => {
    expect(formatTreeGpuSummary(stats({ gpuStatus: "disabled" }))).toBe("cpu-patches");
  });

  it("shows GPU ring counts-off status", () => {
    expect(formatTreeGpuSummary(stats({ gpuStatus: "ring", gpuShowCounts: false }))).toBe("gpu-ring counts=off");
  });

  it("shows GPU ring counters, shadow counters, dispatch, and overflow markers", () => {
    expect(formatTreeGpuSummary(stats({
      gpuStatus: "ring",
      gpuShowCounts: true,
      gpuCandidateCount: 100,
      gpuAcceptedCount: 60,
      gpuVisibleCount: 50,
      gpuShadowCasterCount: 20,
      gpuDispatchMs: 2.34,
      gpuOverflowed: true,
      gpuShadowOverflowed: true,
    }))).toBe("gpu-ring 100/60/50 shadow=20 2.3ms overflow shadow-overflow");
  });

  it("shows fallback and unsupported states", () => {
    expect(formatTreeGpuSummary(stats({ gpuStatus: "fallback-cpu", gpuShowCounts: false }))).toBe("TREE GPU " + "FALLBACK TO CPU");
    expect(formatTreeGpuSummary(stats({ gpuStatus: "unsupported", gpuShowCounts: false }))).toBe("TREE GPU " + "UNSUPPORTED");
  });
});
