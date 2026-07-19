import type { TreeSettings } from "./tree_config.js";
import type { TreeSystemGpuStatus } from "./tree_system_stats.js";

export interface TreeGpuRuntimeAvailability {
  supportsGpuTrees: boolean;
  hasDevice: boolean;
  hasBackend: boolean;
  unsupportedReason?: string | null;
}

export function treeCpuFallbackGpuStatus(settings: TreeSettings): TreeSystemGpuStatus {
  if (!settings.gpu.enabled) return "disabled";
  return settings.gpu.fallbackToCpu ? "fallback-cpu" : "disabled";
}

export function treeGpuRuntimeStatus(
  settings: TreeSettings,
  availability: TreeGpuRuntimeAvailability,
): TreeSystemGpuStatus {
  const unavailable = !availability.supportsGpuTrees || !availability.hasDevice || !availability.hasBackend || !!availability.unsupportedReason;
  if (!unavailable) return "ring";
  return settings.gpu.fallbackToCpu ? "fallback-cpu" : "unsupported";
}

export function treeReportsGpuRingStats(
  usesGpuRingDraw: boolean,
  gpuStatus: TreeSystemGpuStatus,
  hasGpuRingDraw: boolean,
  hasGpuRingCompute: boolean,
  gpuRingStatsStatus: string,
): boolean {
  if (!usesGpuRingDraw || gpuStatus !== "ring") return false;
  if (!hasGpuRingDraw || !hasGpuRingCompute) return false;
  return gpuRingStatsStatus === "ready" || gpuRingStatsStatus === "running";
}
