export interface FarShellMetrics {
  farShellEnabled: boolean;
  farShellInnerM: number;
  farShellOuterM: number;
  farShellVertices: number;
  farShellTriangles: number;
  farShellGridRes: number;
  farShellRebuilds: number;
  farShellLastRebuildMs: number;
  farShellCenterX: number;
  farShellCenterZ: number;
  farShellSnappedX: number;
  farShellSnappedZ: number;
  farShellRebuildPending?: number;
  farShellRebuildCursor?: number;
  farShellRebuildVertices?: number;

  farSummaryTilesRequired: number;
  farSummaryTilesReady: number;
  farSummaryTilesBuilding: number;
  farSummaryTilesMissing: number;
  farSummaryTilesStale: number;
  farSummaryTilesBuiltThisFrame: number;
  farSummaryCacheSize: number;
  farSummaryFallbackSamples: number;
}

export function createFarShellMetrics(): FarShellMetrics {
  return {
    farShellEnabled: false,
    farShellInnerM: 0,
    farShellOuterM: 0,
    farShellVertices: 0,
    farShellTriangles: 0,
    farShellGridRes: 0,
    farShellRebuilds: 0,
    farShellLastRebuildMs: 0,
    farShellCenterX: 0,
    farShellCenterZ: 0,
    farShellSnappedX: 0,
    farShellSnappedZ: 0,
    farShellRebuildPending: 0,
    farShellRebuildCursor: 0,
    farShellRebuildVertices: 0,
    farSummaryTilesRequired: 0,
    farSummaryTilesReady: 0,
    farSummaryTilesBuilding: 0,
    farSummaryTilesMissing: 0,
    farSummaryTilesStale: 0,
    farSummaryTilesBuiltThisFrame: 0,
    farSummaryCacheSize: 0,
    farSummaryFallbackSamples: 0,
  };
}

export function resetFrameShellMetrics(m: FarShellMetrics): void {
  m.farSummaryTilesBuiltThisFrame = 0;
  m.farSummaryFallbackSamples = 0;
}

/** Publishes infinite-far-shell metrics into phase-0 / hook counter maps. */
export function publishFarShellMetricsToCounters(
  counters: Record<string, number>,
  metrics: FarShellMetrics,
): void {
  counters["far_shell_inner_m"] = metrics.farShellInnerM;
  counters["far_shell_outer_m"] = metrics.farShellOuterM;
  counters["far_shell_vertices"] = metrics.farShellVertices;
  counters["far_shell_rebuilds"] = metrics.farShellRebuilds;
  counters["far_shell_last_rebuild_ms"] = metrics.farShellLastRebuildMs;
  counters["far_shell_rebuild_pending"] = metrics.farShellRebuildPending ?? 0;
  counters["far_shell_rebuild_cursor"] = metrics.farShellRebuildCursor ?? 0;
  counters["far_shell_rebuild_vertices"] = metrics.farShellRebuildVertices ?? metrics.farShellVertices;
  counters["far_summary_tiles_required"] = metrics.farSummaryTilesRequired;
  counters["far_summary_tiles_ready"] = metrics.farSummaryTilesReady;
  counters["far_summary_tiles_building"] = metrics.farSummaryTilesBuilding;
  counters["far_summary_tiles_missing"] = metrics.farSummaryTilesMissing;
  counters["far_summary_tiles_stale"] = metrics.farSummaryTilesStale;
  counters["far_summary_tiles_built_this_frame"] = metrics.farSummaryTilesBuiltThisFrame;
  counters["far_summary_cache_size"] = metrics.farSummaryCacheSize;
  counters["far_summary_fallback_samples"] = metrics.farSummaryFallbackSamples;
}

export function exposeMetricsOnWindow(metrics: FarShellMetrics): void {
  (window as unknown as Record<string, unknown>).__drusnielFarShellMetrics = metrics;
}

export function getExposedMetrics(): FarShellMetrics | undefined {
  return (window as unknown as Record<string, unknown>).__drusnielFarShellMetrics as FarShellMetrics | undefined;
}

declare global {
  interface Window {
    __drusnielFarShellMetrics?: FarShellMetrics;
  }
}
