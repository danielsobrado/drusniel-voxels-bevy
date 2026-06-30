import type { TreeLod } from "./tree_config.js";
import type { TreePatch, TreeStats } from "./tree_system_types.js";
import { auditTreeHeroFidelity, createEmptyTreeHeroFidelityStats } from "./tree_hero_fidelity.js";
import type { TreeGeometryMap } from "./tree_geometry.js";
import { buildTreeSystemStats } from "./tree_system_stats.js";
import type { TreeGpuRingRuntimeState } from "./tree_system_gpu_ring_runtime.js";
import type { TreeImpostorStatus } from "./tree_system_types.js";

export interface TreeRuntimeStatsInput {
  patches: readonly TreePatch[];
  geometries: TreeGeometryMap;
  lodCounts: Record<TreeLod, number>;
  reportsGpuRingStats: boolean;
  gpuRing: TreeGpuRingRuntimeState;
  debugShowGpuCounts: boolean;
  impostorStatus: TreeImpostorStatus;
  impostorReason: string | null;
}

export function buildTreeRuntimeStats(input: TreeRuntimeStatsInput): TreeStats {
  return buildTreeSystemStats({
    patches: input.patches,
    lodCounts: input.lodCounts,
    heroFidelity: input.reportsGpuRingStats
      ? createEmptyTreeHeroFidelityStats()
      : auditTreeHeroFidelity({ patches: input.patches, geometries: input.geometries }),
    gpuRing: input.reportsGpuRingStats,
    gpuRingStats: input.gpuRing.stats,
    gpuVisibleCount: input.gpuRing.visibleCount,
    gpuStatus: input.gpuRing.status,
    gpuOverflowed: input.gpuRing.overflowed,
    gpuDispatchMs: input.gpuRing.dispatchMs,
    gpuShowCounts: input.debugShowGpuCounts,
    impostorStatus: input.impostorStatus,
    impostorReason: input.impostorReason,
  });
}
