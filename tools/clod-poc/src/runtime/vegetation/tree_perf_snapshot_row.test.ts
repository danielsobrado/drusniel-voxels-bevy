import { describe, expect, it } from "vitest";
import { createEmptyTreeSystemStats, type TreeStats } from "../../trees/index.js";
import type { TreePerfSnapshotState } from "./tree_perf_snapshot.js";
import { formatTreePerfSnapshotRow } from "./tree_perf_snapshot_row.js";

function state(overrides: Partial<TreePerfSnapshotState> = {}): TreePerfSnapshotState {
  return {
    postProcessQualityPreset: "perf",
    treeDistance: 300,
    treeMaxInstances: 3500,
    treeDensity: 0.55,
    treeSpacing: 9,
    treeShadowMaxLod: "near",
    treeGpuEnabled: true,
    treeGpuForceCpu: false,
    treeGpuShowCounts: true,
    treeGpuReadbackVisibleLists: true,
    treeGpuValidateAgainstCpu: false,
    treeGpuMaxVisible: 16000,
    ...overrides,
  };
}

function stats(overrides: Partial<TreeStats> = {}): TreeStats {
  return { ...createEmptyTreeSystemStats(), ...overrides };
}

describe("tree perf snapshot row", () => {
  it("formats a debug-count table row", () => {
    const row = formatTreePerfSnapshotRow({
      state: state(),
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
        gpuShadowOverflowed: true,
      }),
      url: "?quality=perf&treeGpu=1&treeGpuCounts=1",
    });

    expect(row).toBe("| ?quality=perf&treeGpu=1&treeGpuCounts=1 | gpu-ring | TODO | TODO | 1.23 | 100 | 50 | 42 | 12 | yes | total=42 lod=10/20/8/4 shadowLod=near |");
  });

  it("keeps counts-off totals out of normal GPU rows", () => {
    const row = formatTreePerfSnapshotRow({
      state: state({ treeGpuShowCounts: false, treeGpuReadbackVisibleLists: false }),
      stats: stats({ gpuStatus: "ring", gpuShowCounts: false, totalTrees: 999 }),
      url: "?quality=perf&treeGpu=1",
    });

    expect(row).toContain("total=counts off");
  });
});
