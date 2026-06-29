import type { TreeGenerationStats } from "./tree_instances.js";

export type TreeSystemGpuStatus = "disabled" | "unsupported" | "ring" | "fallback-cpu" | "error";
export type TreeSystemImpostorStatus = "disabled" | "pending" | "baking" | "baked" | "fallback";

export interface TreeSystemStatsSnapshot extends TreeGenerationStats {
  totalTrees: number;
  patches: number;
  visiblePatches: number;
  culledPatches: number;
  nearTrees: number;
  midTrees: number;
  farTrees: number;
  impostorTrees: number;
  gpuStatus: TreeSystemGpuStatus;
  gpuCandidateCount: number;
  gpuAcceptedCount: number;
  gpuVisibleCount: number;
  gpuOverflowed: boolean;
  gpuDispatchMs: number | null;
  gpuShowCounts: boolean;
  impostorStatus: TreeSystemImpostorStatus;
  impostorReason: string | null;
}

export function createEmptyTreeSystemStats(): TreeSystemStatsSnapshot {
  return {
    totalTrees: 0,
    patches: 0,
    visiblePatches: 0,
    culledPatches: 0,
    nearTrees: 0,
    midTrees: 0,
    farTrees: 0,
    impostorTrees: 0,
    gpuStatus: "disabled",
    gpuCandidateCount: 0,
    gpuAcceptedCount: 0,
    gpuVisibleCount: 0,
    gpuOverflowed: false,
    gpuDispatchMs: null,
    gpuShowCounts: true,
    impostorStatus: "disabled",
    impostorReason: null,
    generatedCandidates: 0,
    acceptedCandidates: 0,
    rejectedSlope: 0,
    rejectedHeight: 0,
    rejectedMaterial: 0,
  };
}
