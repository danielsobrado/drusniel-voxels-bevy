import { describe, expect, it } from "vitest";
import { createEmptyTreeSystemStats, type TreeStats } from "./index.js";
import {
  formatTreeGpuFallbackWarning,
  formatTreeGpuOverlayStatus,
  formatTreeGpuStatusPath,
  formatTreeInfoLine,
  formatTreeRuntimePath,
  formatTreeTotalDisplay,
} from "./tree_info.js";

function stats(overrides: Partial<TreeStats> = {}): TreeStats {
  return { ...createEmptyTreeSystemStats(), ...overrides };
}

describe("tree info formatting", () => {
  it("formats user-facing runtime path labels", () => {
    expect(formatTreeGpuStatusPath("ring")).toBe("gpu-ring");
    expect(formatTreeGpuStatusPath("disabled")).toBe("cpu-patches");
    expect(formatTreeGpuStatusPath("fallback-cpu")).toBe("fallback-cpu");
    expect(formatTreeGpuStatusPath("unsupported")).toBe("unsupported");
    expect(formatTreeGpuStatusPath("error")).toBe("error");
  });

  it("uses disabled path when trees are off", () => {
    expect(formatTreeRuntimePath(false, stats({ gpuStatus: "ring" }))).toBe("disabled");
  });

  it("shows GPU ring with counts off without exposing stale totals", () => {
    const treeStats = stats({ gpuStatus: "ring", gpuShowCounts: false, totalTrees: 123 });

    expect(formatTreeTotalDisplay(treeStats)).toBe("counts off");
    expect(formatTreeInfoLine(true, formatTreeTotalDisplay(treeStats), treeStats)).toBe("trees: gpu-ring counts=off");
  });

  it("shows CPU patch path for non-GPU trees", () => {
    const treeStats = stats({ gpuStatus: "disabled", totalTrees: 123, visiblePatches: 4, patches: 8 });

    expect(formatTreeInfoLine(true, 123, treeStats)).toContain("trees: cpu-patches 123 trees");
    expect(formatTreeInfoLine(true, 123, treeStats)).toContain("path=cpu-patches");
  });

  it("shows an unmistakable warning when GPU trees fall back to CPU", () => {
    const treeStats = stats({ gpuStatus: "fallback-cpu", totalTrees: 123 });

    expect(formatTreeGpuFallbackWarning(true, true, treeStats)).toBe("TREE GPU FALLBACK TO CPU");
    expect(formatTreeGpuOverlayStatus(true, true, treeStats)).toBe("TREE GPU FALLBACK TO CPU");
    expect(formatTreeInfoLine(true, 123, treeStats)).toContain("TREE GPU FALLBACK TO CPU");
  });

  it("does not show a fallback warning when GPU trees are disabled on purpose", () => {
    const treeStats = stats({ gpuStatus: "disabled", totalTrees: 123 });

    expect(formatTreeGpuFallbackWarning(true, false, treeStats)).toBeNull();
    expect(formatTreeGpuOverlayStatus(true, false, treeStats)).toBe("cpu-patches");
  });

  it("shows GPU dispatch, shadow, and visible-cluster details when counts are enabled", () => {
    const line = formatTreeInfoLine(true, 42, stats({
      gpuStatus: "ring",
      gpuShowCounts: true,
      gpuCandidateCount: 100,
      gpuAcceptedCount: 50,
      gpuVisibleCount: 42,
      gpuShadowCasterCount: 17,
      visibleClusterHidden: 4,
      visibleClusterVisible: 12,
      visibleClusterUnknownKept: 2,
      gpuDispatchMs: 1.234,
    }));

    expect(line).toContain("trees: gpu-ring 42 trees");
    expect(line).toContain("path=gpu-ring candidates=100 accepted=50 visible=42 shadow=17");
    expect(line).toContain("visibleClusters hidden=4 visible=12 unknown=2");
    expect(line).toContain("dispatch=1.2ms");
  });
});
