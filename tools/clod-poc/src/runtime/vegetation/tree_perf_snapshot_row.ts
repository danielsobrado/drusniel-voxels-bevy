import type { TreeStats } from "../../trees/index.js";
import { formatTreeGpuStatusPath } from "../../trees/tree_info.js";
import type { TreePerfSnapshotInput } from "./tree_perf_snapshot.js";

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
    `total=${formatTotal(stats)}`,
    `lod=${stats.nearTrees}/${stats.midTrees}/${stats.farTrees}/${stats.impostorTrees}`,
    `shadowLod=${input.state.treeShadowMaxLod}`,
  ].join(" ");
}

function formatTotal(stats: TreeStats): string {
  return stats.gpuStatus === "ring" && !stats.gpuShowCounts ? "counts off" : String(stats.totalTrees);
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
