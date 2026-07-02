import type { TreeStats } from "./tree_system.js";
import type { TreeSystemGpuStatus } from "./tree_system_stats.js";

export type TreeTotalDisplay = number | string;

export function formatTreeTotalDisplay(treeStats: TreeStats | null): TreeTotalDisplay {
  if (treeStats && treeGpuCountsHidden(treeStats)) return "counts off";
  return treeStats?.totalTrees ?? 0;
}

export function formatTreeInfoLine(treesEnabled: boolean, totalTrees: TreeTotalDisplay, treeStats: TreeStats | null): string {
  const runtimePath = formatTreeRuntimePath(treesEnabled, treeStats);
  const warning = formatTreeGpuStatusWarning(treeStats);
  if (treeStats && treeGpuCountsHidden(treeStats)) {
    return `trees: ${runtimePath} counts=off${warning}`;
  }
  return `trees: ${runtimePath} ${formatTreeTotal(totalTrees)} trees` +
    (treeStats
      ? ` patches=${treeStats.visiblePatches}/${treeStats.patches}` +
        formatTreeTerrainPatchStats(treeStats) +
        ` lod n/m/f/i=${treeStats.nearTrees}/${treeStats.midTrees}/${treeStats.farTrees}/${treeStats.impostorTrees}` +
        formatTreeImpostorStatus(treeStats) +
        formatTreeGpuStats(treeStats) +
        warning
      : warning);
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

export function formatTreeGpuFallbackWarning(
  treesEnabled: boolean,
  treeGpuEnabled: boolean,
  treeStats: TreeStats | null,
): string | null {
  if (!treesEnabled || !treeGpuEnabled || !treeStats) return null;
  switch (treeStats.gpuStatus) {
    case "ring":
      return null;
    case "fallback-cpu":
      return "TREE GPU FALLBACK TO CPU";
    case "unsupported":
      return "TREE GPU UNSUPPORTED";
    case "error":
      return "TREE GPU ERROR";
    case "disabled":
      return "TREE GPU DISABLED";
    default:
      return "TREE GPU UNKNOWN";
  }
}

export function formatTreeGpuOverlayStatus(
  treesEnabled: boolean,
  treeGpuEnabled: boolean,
  treeStats: TreeStats | null,
): string {
  return formatTreeGpuFallbackWarning(treesEnabled, treeGpuEnabled, treeStats) ??
    formatTreeRuntimePath(treesEnabled, treeStats);
}

function treeGpuCountsHidden(treeStats: TreeStats): boolean {
  return treeStats.gpuStatus === "ring" && !treeStats.gpuShowCounts;
}

function formatTreeGpuStatusWarning(treeStats: TreeStats | null): string {
  if (!treeStats) return "";
  switch (treeStats.gpuStatus) {
    case "fallback-cpu": return "  TREE GPU FALLBACK TO CPU";
    case "unsupported": return "  TREE GPU UNSUPPORTED";
    case "error": return "  TREE GPU ERROR";
    default: return "";
  }
}

function formatTreeTotal(totalTrees: TreeTotalDisplay): string {
  return typeof totalTrees === "number" ? totalTrees.toLocaleString() : totalTrees;
}

function formatTreeTerrainPatchStats(treeStats: TreeStats): string {
  const late = treeStats.terrainOccludedPatches > 0 ? ` terrainOccPatches=${treeStats.terrainOccludedPatches}` : "";
  const early = treeStats.earlyTerrainRejectedPatches > 0
    ? ` earlyTerrainReject=${treeStats.earlyTerrainRejectedPatches}` +
      ` skippedCandidates=${treeStats.earlyTerrainSkippedCandidates}` +
      formatTreeEarlyTerrainReasonStats(treeStats)
    : "";
  return `${late}${early}`;
}

function formatTreeEarlyTerrainReasonStats(treeStats: TreeStats): string {
  const parts: string[] = [];
  if (treeStats.earlyTerrainHiddenPatches > 0) parts.push(`hidden=${treeStats.earlyTerrainHiddenPatches}`);
  if (treeStats.earlyTerrainWaterPatches > 0) parts.push(`water=${treeStats.earlyTerrainWaterPatches}`);
  if (treeStats.earlyTerrainBiomePatches > 0) parts.push(`biome=${treeStats.earlyTerrainBiomePatches}`);
  if (treeStats.earlyTerrainSteepPatches > 0) parts.push(`steep=${treeStats.earlyTerrainSteepPatches}`);
  if (treeStats.earlyTerrainHeightPatches > 0) parts.push(`height=${treeStats.earlyTerrainHeightPatches}`);
  if (treeStats.earlyTerrainOutsidePatches > 0) parts.push(`outside=${treeStats.earlyTerrainOutsidePatches}`);
  return parts.length > 0 ? ` reasons(${parts.join(",")})` : "";
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
    ` shadow=${treeStats.gpuShadowCasterCount}` +
    formatTreeTerrainCandidateStats(treeStats) +
    formatTreeVisibleClusterStats(treeStats) +
    `${dispatch}${overflow}${shadowOverflow}`;
}

function formatTreeTerrainCandidateStats(treeStats: TreeStats): string {
  const hasCounts = treeStats.terrainHiddenCandidates > 0 ||
    treeStats.terrainVisibleCandidates > 0;
  if (!hasCounts) return "";
  return ` terrainOccCandidates=${treeStats.terrainHiddenCandidates}` +
    ` terrainVisibleCandidates=${treeStats.terrainVisibleCandidates}`;
}

function formatTreeVisibleClusterStats(treeStats: TreeStats): string {
  const hasCounts = treeStats.visibleClusterHidden > 0 ||
    treeStats.visibleClusterVisible > 0 ||
    treeStats.visibleClusterUnknownKept > 0;
  if (!hasCounts) return "";
  return ` visibleClusters hidden=${treeStats.visibleClusterHidden}` +
    ` visible=${treeStats.visibleClusterVisible}` +
    (treeStats.visibleClusterUnknownKept > 0 ? ` unknown=${treeStats.visibleClusterUnknownKept}` : "");
}
