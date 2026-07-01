import { describe, expect, it } from "vitest";
import { createEmptyTreeSystemStats, type TreeStats } from "./index.js";
import {
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

  it("shows GPU dispatch and shadow details when counts are enabled", () => {
    const line = formatTreeInfoLine(true, 42, stats({
      gpuStatus: "ring",
      gpuShowCounts: true,
      gpuCandidateCount: 100,
      gpuAcceptedCount: 50,
      gpuVisibleCount: 42,
      gpuShadowCasterCount: 17,
      gpuDispatchMs: 1.234,
    }));

    expect(line).toContain("trees: gpu-ring 42 trees");
    expect(line).toContain("path=gpu-ring candidates=100 accepted=50 visible=42 shadow=17 dispatch=1.2ms");
  });
});
