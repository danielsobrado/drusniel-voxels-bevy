import type { TreeStats } from "../../trees/index.js";
import type { UnderstoryStats } from "../../understory/index.js";

export function formatTreeGpuSummary(stats: TreeStats): string {
  return stats.gpuStatus === "disabled"
    ? "disabled"
    : `${stats.gpuStatus} ${stats.gpuCandidateCount}/${stats.gpuAcceptedCount}/${stats.gpuVisibleCount}${stats.gpuOverflowed ? " overflow" : ""}`;
}

export function formatUnderstoryGpuSummary(stats: UnderstoryStats): string {
  return stats.gpuStatus === "disabled"
    ? "disabled"
    : `${stats.gpuStatus} ${stats.gpuCandidateCount}/${stats.gpuAcceptedCount}/${stats.gpuVisibleCount}${stats.gpuOverflowed ? " overflow" : ""}${stats.gpuDispatchMs !== null ? ` ${stats.gpuDispatchMs.toFixed(1)}ms` : ""}`;
}
