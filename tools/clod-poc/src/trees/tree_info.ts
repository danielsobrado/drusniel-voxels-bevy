import type { TreeStats } from "./tree_system.js";
import type { TreeSystemGpuStatus } from "./tree_system_stats.js";

export type TreeTotalDisplay = number | string;

export function formatTreeTotalDisplay(treeStats: TreeStats | null): TreeTotalDisplay {
  if (treeStats && treeGpuCountsHidden(treeStats)) return "counts off";
  return treeStats?.totalTrees ?? 0;
}

export function formatTreeInfoLine(treesEnabled: boolean, totalTrees: TreeTotalDisplay, treeStats: TreeStats | null): string {
  const runtimePath = formatTreeRuntimePath(treesEnabled, treeStats);
  if (treeStats && treeGpuCountsHidden(treeStats)) {
    return `trees: ${runtimePath} counts=off`;
  }
  return `trees: ${runtimePath} ${formatTreeTotal(totalTrees)} trees` +
    (treeStats
      ? ` patches=${treeStats.visiblePatches}/${treeStats.patches}` +
        formatTreeTerrainHidden(treeStats) +
        ` lod n/m/f/i=${treeStats.nearTrees}/${treeStats.midTrees}/${treeStats.farTrees}/${treeStats.impostorTrees}` +
        formatTreeImpostorStatus(treeStats) +
        formatTreeGpuStats(treeStats)
      : "");
}

export function formatTreeRuntimePath(treesEnabled: boolean, treeStats: TreeStats | null): string {
  if (!treesEnabled) return "disabled";
  if (!treeStats) return "unknown";
  return formatTreeGpuStatusPath(treeStats.gpuStatus);
}

export function formatTreeGpuStatusPath(status: TreeSystemGpuStatus): string {
  switch (status) {
    case "ring": return "gpu-ring";
    case "disabled": return "cpu-patches";
    case "fallback-cpu": return "fallback-cpu";
    case "unsupported": return "unsupported";
    case "error": return "error";
    default: return "unknown";
  }
}

function treeGpuCountsHidden(treeStats: TreeStats): boolean {
  return treeStats.gpuStatus === "ring" && !treeStats.gpuShowCounts;
}

function formatTreeTotal(totalTrees: TreeTotalDisplay): string {
  return typeof totalTrees === "number" ? totalTrees.toLocaleString() : totalTrees;
}

function formatTreeTerrainHidden(treeStats: TreeStats): string {
  return treeStats.terrainOccludedPatches > 0 ? ` terrainHidden=${treeStats.terrainOccludedPatches}` : "";
}

function formatTreeImpostorStatus(treeStats: TreeStats): string {
  if (treeStats.impostorStatus === "disabled") return "";
  const reason = treeStats.impostorStatus === "fallback" && treeStats.impostorReason
    ? ` (${treeStats.impostorReason})`
    : "";
  return ` imp=${treeStats.impostorStatus}${reason}`;
}

function formatTreeGpuStats(treeStats: TreeStats): string {
  const path = formatTreeGpuStatusPath(treeStats.gpuStatus);
  if (treeStats.gpuStatus === "disabled") return ` path=${path}`;
  if (!treeStats.gpuShowCounts) return ` path=${path}`;
  const overflow = treeStats.gpuOverflowed ? " overflow" : "";
  const shadowOverflow = treeStats.gpuShadowOverflowed ? " shadow-overflow" : "";
  const dispatch = treeStats.gpuDispatchMs !== null ? ` dispatch=${treeStats.gpuDispatchMs.toFixed(1)}ms` : "";
  return ` path=${path} candidates=${treeStats.gpuCandidateCount}` +
    ` accepted=${treeStats.gpuAcceptedCount} visible=${treeStats.gpuVisibleCount}` +
    ` shadow=${treeStats.gpuShadowCasterCount}${dispatch}${overflow}${shadowOverflow}`;
}
