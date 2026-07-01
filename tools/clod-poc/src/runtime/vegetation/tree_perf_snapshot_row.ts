import type { TreeStats } from "../../trees/index.js";
import { formatTreeGpuStatusPath } from "../../trees/tree_info.js";
import type { TreePerfSnapshotInput, TreePerfSnapshotState } from "./tree_perf_snapshot.js";

export function formatTreePerfSnapshotRow(input: TreePerfSnapshotInput): string {
  const stats = input.stats;
  const cells = [
    input.url ?? "unknown",
    stats ? formatTreeGpuStatusPath(stats.gpuStatus) : "unknown",
    "TODO",
    "TODO",
    stats ? formatDispatchMs(stats) : "n/a",
    stats ? String(stats.gpuCandidateCount) : "unknown",
    stats ? String(stats.gpuAcceptedCount) : "unknown",
    stats ? String(stats.gpuVisibleCount) : "unknown",
    stats ? String(stats.gpuShadowCasterCount) : "unknown",
    stats ? yesNo(stats.gpuShadowOverflowed) : "unknown",
    stats ? formatNotes(input, stats) : "stats unavailable",
  ];
  return `| ${cells.map(cleanCell).join(" | ")} |`;
}

function formatNotes(input: TreePerfSnapshotInput, stats: TreeStats): string {
  return [
    `total=${formatTreePerfTotal(input.state, stats)}`,
    `lod=${stats.nearTrees}/${stats.midTrees}/${stats.farTrees}/${stats.impostorTrees}`,
    `shadowLod=${input.state.treeShadowMaxLod}`,
  ].join(" ");
}

// A "ring" total is only trustworthy once the GPU count readback has actually
// run. The readback fires whenever visible-list readback or CPU-parity
// validation is enabled (see treeGpuRingRequestsDebugReadback); debugShowGpuCounts
// is display-only and does not gate it, so it must not gate this either.
export function treePerfCountsAvailable(state: TreePerfSnapshotState): boolean {
  return state.treeGpuReadbackVisibleLists || state.treeGpuValidateAgainstCpu;
}

export function formatTreePerfTotal(state: TreePerfSnapshotState, stats: TreeStats): string {
  if (stats.gpuStatus !== "ring") return String(stats.totalTrees);
  return treePerfCountsAvailable(state) ? String(stats.totalTrees) : "counts off";
}

function formatDispatchMs(stats: TreeStats): string {
  return stats.gpuDispatchMs === null ? "n/a" : stats.gpuDispatchMs.toFixed(2);
}

function cleanCell(value: string): string {
  return value.split("|").join("/").split("\n").join(" ").split("\r").join(" ");
}

function yesNo(value: boolean): "yes" | "no" {
  return value ? "yes" : "no";
}
