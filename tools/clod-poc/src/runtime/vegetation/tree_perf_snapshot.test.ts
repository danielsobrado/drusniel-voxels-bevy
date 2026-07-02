import { describe, expect, it } from "vitest";
import { createEmptyTreeSystemStats, type TreeStats } from "../../trees/index.js";
import { formatTreePerfSnapshot, type TreePerfSnapshotState } from "./tree_perf_snapshot.js";

function state(overrides: Partial<TreePerfSnapshotState> = {}): TreePerfSnapshotState {
  return {
    postProcessQualityPreset: "perf",
    treeDistance: 300,
    treeMaxInstances: 3500,
    treeDensity: 0.55,
    treeSpacing: 9,
    treeShadowMaxLod: "near",
    treeGpuEnabled: true,
    treeGpuFallbackToCpu: true,
    treeGpuForceCpu: false,
    treeGpuShowCounts: false,
    treeGpuReadbackVisibleLists: false,
    treeGpuValidateAgainstCpu: false,
    treeGpuMaxVisible: 16000,
    ...overrides,
  };
}

function stats(overrides: Partial<TreeStats> = {}): TreeStats {
  return { ...createEmptyTreeSystemStats(), ...overrides };
}

describe("tree perf snapshot", () => {
  it("formats GPU counts-off snapshots without stale totals", () => {
    const snapshot = formatTreePerfSnapshot({
      state: state(),
      stats: stats({ gpuStatus: "ring", gpuShowCounts: false, totalTrees: 999 }),
      url: "?quality=perf&treeGpu=1",
      now: new Date("2026-07-01T12:00:00.000Z"),
    });

    expect(snapshot).toContain("- date: 2026-07-01T12:00:00.000Z");
    expect(snapshot).toContain("- url: ?quality=perf&treeGpu=1");
    expect(snapshot).toContain("- runtime path: gpu-ring");
    expect(snapshot).toContain("- total / counts: counts off");
    expect(snapshot).toContain("## Capture Table Row");
    expect(snapshot).toContain("total=counts off");
    expect(snapshot).toContain("- treeShadowMaxLod: near");
    expect(snapshot).toContain("- treeGpuFallbackToCpu: true");
  });

  it("formats GPU debug count details", () => {
    const snapshot = formatTreePerfSnapshot({
      state: state({ treeGpuShowCounts: true, treeGpuReadbackVisibleLists: true }),
      stats: stats({
        gpuStatus: "ring",
        gpuShowCounts: true,
        totalTrees: 42,
        nearTrees: 10,
        midTrees: 20,
        farTrees: 8,
        impostorTrees: 4,
        gpuDispatchMs: 1.234,
        gpuCandidateCount: 100,
        gpuAcceptedCount: 50,
        gpuVisibleCount: 42,
        gpuShadowCasterCount: 12,
        gpuOverflowed: false,
        gpuShadowOverflowed: true,
      }),
      now: new Date("2026-07-01T12:00:00.000Z"),
    });

    expect(snapshot).toContain("- total / counts: 42");
    expect(snapshot).toContain("- lod n/m/f/i: 10/20/8/4");
    expect(snapshot).toContain("- gpu dispatch ms: 1.23");
    expect(snapshot).toContain("- gpu candidates / accepted / visible: 100/50/42");
    expect(snapshot).toContain("- gpu shadow casters: 12");
    expect(snapshot).toContain("- gpu shadow overflow: yes");
    expect(snapshot).toContain("| unknown | gpu-ring | TODO | TODO | 1.23 | 100 | 50 | 42 | 12 | yes | total=42 lod=10/20/8/4 shadowLod=near |");
  });
});
