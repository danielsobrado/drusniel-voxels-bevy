import { describe, expect, it } from "vitest";
import type { TreeGpuRingRuntimeState } from "./tree_system_gpu_ring_runtime.js";
import {
  treeGpuRingReportsRuntimeStats,
  type TreeGpuRingStatsAuthorityState,
} from "./tree_gpu_ring_stats_authority.js";

describe("tree GPU ring stats authority", () => {
  it.each(["ready", "running"] as const)("reports live %s GPU stats", (status) => {
    expect(treeGpuRingReportsRuntimeStats(state({ statsStatus: status }))).toBe(true);
  });

  it("keeps CPU stats authoritative during GPU initialization", () => {
    expect(treeGpuRingReportsRuntimeStats(state({ statsStatus: "initializing" }))).toBe(false);
  });

  it("keeps CPU stats authoritative after GPU fallback", () => {
    expect(treeGpuRingReportsRuntimeStats(state({ runtimeStatus: "fallback-cpu" }))).toBe(false);
  });

  it("requires both compute and draw publication", () => {
    expect(treeGpuRingReportsRuntimeStats(state({ compute: false }))).toBe(false);
    expect(treeGpuRingReportsRuntimeStats(state({ draw: false }))).toBe(false);
  });
});

interface StateOptions {
  runtimeStatus?: TreeGpuRingRuntimeState["status"];
  statsStatus?: TreeGpuRingRuntimeState["stats"]["status"];
  compute?: boolean;
  draw?: boolean;
}

function state(options: StateOptions = {}): TreeGpuRingStatsAuthorityState {
  return {
    status: options.runtimeStatus ?? "ring",
    compute: options.compute === false ? null : {} as TreeGpuRingRuntimeState["compute"],
    draw: options.draw === false ? null : {} as TreeGpuRingRuntimeState["draw"],
    stats: {
      status: options.statsStatus ?? "ready",
    } as TreeGpuRingRuntimeState["stats"],
  };
}
