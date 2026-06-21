import type { TreeStats } from "./tree_system.js";

export function formatTreeInfoLine(treesEnabled: boolean, totalTrees: number, treeStats: TreeStats | null): string {
  return `trees: ${treesEnabled ? "enabled" : "disabled"} ${totalTrees.toLocaleString()} trees` +
    (treeStats
      ? ` patches=${treeStats.visiblePatches}/${treeStats.patches}` +
        ` lod n/m/f/i=${treeStats.nearTrees}/${treeStats.midTrees}/${treeStats.farTrees}/${treeStats.impostorTrees}` +
        formatTreeImpostorStatus(treeStats) +
        formatTreeGpuStats(treeStats)
      : "");
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
  if (!treeStats.gpuShowCounts && treeStats.gpuStatus === "ready") return "";
  if (!treeStats.gpuShowCounts) return ` gpu=${treeStats.gpuStatus}`;
  const overflow = treeStats.gpuOverflowed ? " overflow" : "";
  return ` gpu=${treeStats.gpuStatus} candidates=${treeStats.gpuCandidateCount} visible=${treeStats.gpuVisibleCount}${overflow}`;
}
