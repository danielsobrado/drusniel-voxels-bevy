import type { TreeStats } from "./tree_system.js";

export type TreeTotalDisplay = number | string;

export function formatTreeTotalDisplay(treeStats: TreeStats | null): TreeTotalDisplay {
  if (treeStats && treeGpuCountsHidden(treeStats)) return "counts off";
  return treeStats?.totalTrees ?? 0;
}

export function formatTreeInfoLine(treesEnabled: boolean, totalTrees: TreeTotalDisplay, treeStats: TreeStats | null): string {
  if (treeStats && treeGpuCountsHidden(treeStats)) {
    return `trees: ${treesEnabled ? "enabled" : "disabled"} gpu=${treeStats.gpuStatus} counts=off`;
  }
  return `trees: ${treesEnabled ? "enabled" : "disabled"} ${formatTreeTotal(totalTrees)} trees` +
    (treeStats
      ? ` patches=${treeStats.visiblePatches}/${treeStats.patches}` +
        ` lod n/m/f/i=${treeStats.nearTrees}/${treeStats.midTrees}/${treeStats.farTrees}/${treeStats.impostorTrees}` +
        formatTreeImpostorStatus(treeStats) +
        formatTreeGpuStats(treeStats)
      : "");
}

function treeGpuCountsHidden(treeStats: TreeStats): boolean {
  return treeStats.gpuStatus === "ring" && !treeStats.gpuShowCounts;
}

function formatTreeTotal(totalTrees: TreeTotalDisplay): string {
  return typeof totalTrees === "number" ? totalTrees.toLocaleString() : totalTrees;
}

function formatTreeImpostorStatus(treeStats: TreeStats): string {
  if (treeStats.impostorStatus === "disabled") return "";
  const reason = treeStats.impostorStatus === "fallback" && treeStats.impostorReason
    ? ` (${treeStats.impostorReason})`
    : "";
  return ` imp=${treeStats.impostorStatus}${reason}`;
}

function formatTreeGpuStats(treeStats: TreeStats): string {
  if (treeStats.gpuStatus === "disabled") return "";
  if (!treeStats.gpuShowCounts) return ` gpu=${treeStats.gpuStatus}`;
  const overflow = treeStats.gpuOverflowed ? " overflow" : "";
  return ` gpu=${treeStats.gpuStatus} candidates=${treeStats.gpuCandidateCount}` +
    ` accepted=${treeStats.gpuAcceptedCount} visible=${treeStats.gpuVisibleCount}${overflow}`;
}
