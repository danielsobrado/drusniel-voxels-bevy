export interface FarShellMetrics {
  farShellEnabled: boolean;
  farShellInnerM: number;
  farShellOuterM: number;
  farShellVertices: number;
  farShellTriangles: number;
  farShellGridRes: number;
  farShellRebuilds: number;
  farShellRebuildRestarts: number;
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
  farSummaryTerrainWaterReady: number;
  farSummaryWaterPending: number;
  farSummaryCanopyPending: number;
  farSummaryFullyEnriched: number;
  farSummaryTilesBuiltThisFrame: number;
  farSummaryCacheSize: number;
  farSummaryFallbackSamples: number;
  farSummaryProceduralFallbackSamples: number;
  farSummaryLowerRingFallbackSamples: number;
  farSummaryConservativeFallbackSamples: number;
  farSummaryStaleRestores: number;
  farSummaryBuildsDiscarded: number;
  farSummaryProbeFallbacks: number;
  farSummaryProbeHeightErrorMaxM: number;
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
    farShellRebuildRestarts: 0,
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
    farSummaryTerrainWaterReady: 0,
    farSummaryWaterPending: 0,
    farSummaryCanopyPending: 0,
    farSummaryFullyEnriched: 0,
    farSummaryTilesBuiltThisFrame: 0,
    farSummaryCacheSize: 0,
    farSummaryFallbackSamples: 0,
    farSummaryProceduralFallbackSamples: 0,
    farSummaryLowerRingFallbackSamples: 0,
    farSummaryConservativeFallbackSamples: 0,
    farSummaryStaleRestores: 0,
    farSummaryBuildsDiscarded: 0,
    farSummaryProbeFallbacks: 0,
    farSummaryProbeHeightErrorMaxM: 0,
  };
}

export function resetFrameShellMetrics(m: FarShellMetrics): void {
  m.farSummaryTilesBuiltThisFrame = 0;
  m.farSummaryFallbackSamples = 0;
  m.farSummaryProceduralFallbackSamples = 0;
  m.farSummaryLowerRingFallbackSamples = 0;
  m.farSummaryConservativeFallbackSamples = 0;
  m.farSummaryBuildsDiscarded = 0;
  m.farSummaryProbeFallbacks = 0;
  m.farSummaryProbeHeightErrorMaxM = 0;
}

// ?farDebug=1 — periodic console trace of the far/near handoff ("two areas" symptom):
// how much of the far surface is still rendering procedural-fallback heights, and how
// far the summary tile build has progressed. One line every ~2 s while warming, plus a
// single "converged" line when fallbacks reach zero.
const FAR_DEBUG_LOG_EVERY_FRAMES = 120;
let farDebugEnabled: boolean | null = null;
let farDebugFrame = 0;
let farDebugConvergedLogged = false;

function maybeLogFarDebug(metrics: FarShellMetrics): void {
  if (farDebugEnabled === null) {
    farDebugEnabled =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("farDebug") === "1";
  }
  if (!farDebugEnabled) return;
  const warming =
    metrics.farSummaryProceduralFallbackSamples > 0 ||
    metrics.farSummaryTilesReady < metrics.farSummaryTilesRequired;
  if (warming) {
    farDebugConvergedLogged = false;
    if (farDebugFrame++ % FAR_DEBUG_LOG_EVERY_FRAMES === 0) {
      console.info(
        `[far-debug] warming: proceduralFallbackSamples=${metrics.farSummaryProceduralFallbackSamples} ` +
          `lower=${metrics.farSummaryLowerRingFallbackSamples} conservative=${metrics.farSummaryConservativeFallbackSamples} ` +
          `summaryTiles=${metrics.farSummaryTilesReady}/${metrics.farSummaryTilesRequired} ` +
          `building=${metrics.farSummaryTilesBuilding} missing=${metrics.farSummaryTilesMissing}`,
      );
    }
  } else if (!farDebugConvergedLogged) {
    farDebugConvergedLogged = true;
    console.info(
      `[far-debug] converged: summaryTiles=${metrics.farSummaryTilesReady}/${metrics.farSummaryTilesRequired}, ` +
        "no procedural fallback samples this frame",
    );
  }
}

/** Publishes infinite-far-shell metrics into phase-0 / hook counter maps. */
export function publishFarShellMetricsToCounters(
  counters: Record<string, number>,
  metrics: FarShellMetrics,
): void {
  maybeLogFarDebug(metrics);
  counters["far_shell_inner_m"] = metrics.farShellInnerM;
  counters["far_shell_outer_m"] = metrics.farShellOuterM;
  counters["far_shell_vertices"] = metrics.farShellVertices;
  counters["far_shell_rebuilds"] = metrics.farShellRebuilds;
  counters["far_shell_rebuild_restarts"] = metrics.farShellRebuildRestarts;
  counters["far_shell_last_rebuild_ms"] = metrics.farShellLastRebuildMs;
  counters["far_shell_rebuild_pending"] = metrics.farShellRebuildPending ?? 0;
  counters["far_shell_rebuild_cursor"] = metrics.farShellRebuildCursor ?? 0;
  counters["far_shell_rebuild_vertices"] = metrics.farShellRebuildVertices ?? metrics.farShellVertices;
  counters["far_summary_tiles_required"] = metrics.farSummaryTilesRequired;
  counters["far_summary_tiles_ready"] = metrics.farSummaryTilesReady;
  counters["far_summary_tiles_building"] = metrics.farSummaryTilesBuilding;
  counters["far_summary_tiles_missing"] = metrics.farSummaryTilesMissing;
  counters["far_summary_tiles_stale"] = metrics.farSummaryTilesStale;
  counters["far_summary_terrain_water_ready"] = metrics.farSummaryTerrainWaterReady ?? 0;
  counters["far_summary_water_pending"] = metrics.farSummaryWaterPending ?? 0;
  counters["far_summary_canopy_pending"] = metrics.farSummaryCanopyPending ?? 0;
  counters["far_summary_fully_enriched"] = metrics.farSummaryFullyEnriched ?? 0;
  counters["far_summary_tiles_built_this_frame"] = metrics.farSummaryTilesBuiltThisFrame;
  counters["far_summary_cache_size"] = metrics.farSummaryCacheSize;
  counters["far_summary_fallback_samples"] = metrics.farSummaryFallbackSamples;
  counters["far_summary_procedural_fallback_samples"] = metrics.farSummaryProceduralFallbackSamples;
  counters["far_summary_lower_ring_fallback_samples"] = metrics.farSummaryLowerRingFallbackSamples;
  counters["far_summary_conservative_fallback_samples"] = metrics.farSummaryConservativeFallbackSamples;
  counters["far_summary_stale_restores"] = metrics.farSummaryStaleRestores;
  counters["far_summary_builds_discarded"] = metrics.farSummaryBuildsDiscarded;
  counters["far_summary_probe_fallbacks"] = metrics.farSummaryProbeFallbacks;
  counters["far_summary_probe_height_error_max_m"] = metrics.farSummaryProbeHeightErrorMaxM;
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
