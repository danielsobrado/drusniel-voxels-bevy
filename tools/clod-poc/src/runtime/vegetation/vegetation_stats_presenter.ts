import { formatTreeGpuStatusPath } from "../../trees/tree_info.js";
import type { TreeStats } from "../../trees/index.js";
import type { UnderstoryStats } from "../../understory/index.js";

export function formatTreeGpuSummary(stats: TreeStats): string {
  const path = formatTreeGpuStatusPath(stats.gpuStatus);
  if (stats.gpuStatus === "disabled") return path;
  if (!stats.gpuShowCounts) return `${path} counts=off`;
  const overflow = stats.gpuOverflowed ? " overflow" : "";
  const shadowOverflow = stats.gpuShadowOverflowed ? " shadow-overflow" : "";
  const dispatch = stats.gpuDispatchMs !== null ? ` ${stats.gpuDispatchMs.toFixed(1)}ms` : "";
  return `${path} ${stats.gpuCandidateCount}/${stats.gpuAcceptedCount}/${stats.gpuVisibleCount}` +
    ` shadow=${stats.gpuShadowCasterCount}${dispatch}${overflow}${shadowOverflow}`;
}

export function formatUnderstoryGpuSummary(stats: UnderstoryStats): string {
  return stats.gpuStatus === "disabled"
    ? "disabled"
    : `${stats.gpuStatus} ${stats.gpuCandidateCount}/${stats.gpuAcceptedCount}/${stats.gpuVisibleCount}${stats.gpuOverflowed ? " overflow" : ""}${stats.gpuDispatchMs !== null ? ` ${stats.gpuDispatchMs.toFixed(1)}ms` : ""}`;
}
