import type { TreeGpuRingRuntimeState } from "./tree_system_gpu_ring_runtime.js";

export type TreeGpuRingStatsAuthorityState = Pick<
  TreeGpuRingRuntimeState,
  "status" | "compute" | "draw" | "stats"
>;

export function treeGpuRingReportsRuntimeStats(state: TreeGpuRingStatsAuthorityState): boolean {
  const statsStatus = state.stats.status;
  return state.status === "ring"
    && !!state.compute
    && !!state.draw
    && (statsStatus === "ready" || statsStatus === "running");
}
