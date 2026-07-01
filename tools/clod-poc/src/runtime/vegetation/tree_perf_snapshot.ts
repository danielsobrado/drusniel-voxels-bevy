import type { TreeStats } from "../../trees/index.js";
import { formatTreeGpuStatusPath } from "../../trees/tree_info.js";
import { formatTreePerfSnapshotRow, formatTreePerfTotal } from "./tree_perf_snapshot_row.js";

export interface TreePerfSnapshotState {
  postProcessQualityPreset?: string;
  treeDistance: number;
  treeMaxInstances: number;
  treeDensity: number;
  treeSpacing: number;
  treeShadowMaxLod: string;
  treeGpuEnabled: boolean;
  treeGpuForceCpu: boolean;
  treeGpuShowCounts: boolean;
  treeGpuReadbackVisibleLists: boolean;
  treeGpuValidateAgainstCpu: boolean;
  treeGpuMaxVisible: number;
}

export interface TreePerfSnapshotInput {
  state: TreePerfSnapshotState;
  stats: TreeStats | null;
  url?: string;
  now?: Date;
}

export function formatTreePerfSnapshot(input: TreePerfSnapshotInput): string {
  const state = input.state;
  const stats = input.stats;
  const runtimePath = stats ? formatTreeGpuStatusPath(stats.gpuStatus) : "unknown";
  const dispatchMs = stats?.gpuDispatchMs === null || stats?.gpuDispatchMs === undefined
    ? "n/a"
    : stats.gpuDispatchMs.toFixed(2);

  return [
    "# Tree Perf Snapshot",
    "",
    `- date: ${(input.now ?? new Date()).toISOString()}`,
    `- url: ${input.url ?? "unknown"}`,
    `- quality: ${state.postProcessQualityPreset ?? "unknown"}`,
    `- runtime path: ${runtimePath}`,
    `- total / counts: ${stats ? formatTreePerfTotal(state, stats) : "unknown"}`,
    `- lod n/m/f/i: ${stats ? `${stats.nearTrees}/${stats.midTrees}/${stats.farTrees}/${stats.impostorTrees}` : "unknown"}`,
    `- gpu dispatch ms: ${dispatchMs}`,
    `- gpu candidates / accepted / visible: ${stats ? `${stats.gpuCandidateCount}/${stats.gpuAcceptedCount}/${stats.gpuVisibleCount}` : "unknown"}`,
    `- gpu shadow casters: ${stats?.gpuShadowCasterCount ?? "unknown"}`,
    `- gpu overflow: ${stats ? yesNo(stats.gpuOverflowed) : "unknown"}`,
    `- gpu shadow overflow: ${stats ? yesNo(stats.gpuShadowOverflowed) : "unknown"}`,
    "",
    "## Capture Table Row",
    "",
    formatTreePerfSnapshotRow(input),
    "",
    "## Tree Settings",
    "",
    `- treeDistance: ${state.treeDistance}`,
    `- treeMaxInstances: ${state.treeMaxInstances}`,
    `- treeDensity: ${state.treeDensity}`,
    `- treeSpacing: ${state.treeSpacing}`,
    `- treeShadowMaxLod: ${state.treeShadowMaxLod}`,
    `- treeGpuEnabled: ${state.treeGpuEnabled}`,
    `- treeGpuForceCpu: ${state.treeGpuForceCpu}`,
    `- treeGpuShowCounts: ${state.treeGpuShowCounts}`,
    `- treeGpuReadbackVisibleLists: ${state.treeGpuReadbackVisibleLists}`,
    `- treeGpuValidateAgainstCpu: ${state.treeGpuValidateAgainstCpu}`,
    `- treeGpuMaxVisible: ${state.treeGpuMaxVisible}`,
    "",
  ].join("\n");
}

function yesNo(value: boolean): "yes" | "no" {
  return value ? "yes" : "no";
}
