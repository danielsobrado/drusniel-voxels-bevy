import type { FarClipmapStats } from "./far_clipmap_controller.js";

interface FallbackEpochState {
  baselineTotal: number | null;
  lastLifetimeTotal: number;
}

const fallbackEpochByCounters = new WeakMap<Record<string, number>, FallbackEpochState>();

function fallbackSamplesSinceStreamReady(
  counters: Record<string, number>,
  stats: FarClipmapStats,
): number {
  let state = fallbackEpochByCounters.get(counters);
  if (!state) {
    state = { baselineTotal: null, lastLifetimeTotal: stats.fallbackSamplesTotal };
    fallbackEpochByCounters.set(counters, state);
  }

  const streamReadyFrame = counters["stream_ready_frame"];
  const ready = Number.isFinite(streamReadyFrame)
    && streamReadyFrame >= 0
    && stats.sourceReady === 1
    && stats.pendingTiles === 0;

  if (stats.fallbackSamplesTotal < state.lastLifetimeTotal) {
    state.baselineTotal = null;
  }

  if (!ready) {
    state.baselineTotal = null;
    state.lastLifetimeTotal = stats.fallbackSamplesTotal;
    return 0;
  }

  if (state.baselineTotal === null) {
    state.baselineTotal = Math.min(state.lastLifetimeTotal, stats.fallbackSamplesTotal);
  }
  state.lastLifetimeTotal = stats.fallbackSamplesTotal;
  return Math.max(0, stats.fallbackSamplesTotal - state.baselineTotal);
}

export function publishFarClipmapStatsToCounters(counters: Record<string, number>, stats: FarClipmapStats): void {
  counters["far_clipmap_enabled"] = stats.enabled;
  counters["far_clipmap_visible"] = stats.visible;
  counters["far_clipmap_active_rings"] = stats.ringCount;
  counters["far_clipmap_ready_tiles"] = stats.readyTiles;
  counters["far_clipmap_pending_tiles"] = stats.pendingTiles;
  counters["far_clipmap_rebuilt_this_frame"] = stats.rebuiltTilesThisFrame;
  counters["far_clipmap_snap_updates_this_frame"] = stats.snapUpdatesThisFrame;
  counters["far_clipmap_source_refreshes_this_frame"] = stats.sourceRefreshesThisFrame;
  counters["far_clipmap_source_refreshes_total"] = stats.sourceRefreshesTotal;
  counters["far_clipmap_source_refresh_ms"] = stats.sourceRefreshMsThisFrame;
  counters["far_clipmap_source_refresh_ms_total"] = stats.sourceRefreshMsTotal;
  counters["far_clipmap_source_revision"] = stats.sourceRevision;
  counters["far_clipmap_inner_radius_m"] = stats.innerRadiusM;
  counters["far_clipmap_outer_radius_m"] = stats.outerRadiusM;
  counters["far_clipmap_snap_size_m"] = stats.snapSizeM;
  counters["far_clipmap_center_x"] = stats.centerX;
  counters["far_clipmap_center_z"] = stats.centerZ;
  counters["far_clipmap_snapped_origin_x"] = stats.snappedOriginX;
  counters["far_clipmap_snapped_origin_z"] = stats.snappedOriginZ;
  counters["far_clipmap_snap_error_x_m"] = stats.snapErrorXM;
  counters["far_clipmap_snap_error_z_m"] = stats.snapErrorZM;
  counters["far_clipmap_snap_error_max_m"] = stats.snapErrorMaxM;
  counters["far_clipmap_shader_displacement_enabled"] = stats.shaderDisplacementEnabled;
  counters["far_clipmap_shader_displaced_tiles"] = stats.shaderDisplacedTiles;
  counters["far_clipmap_cpu_baked_tiles"] = stats.cpuBakedTiles;
  counters["far_clipmap_reusable_grid_tiles"] = stats.reusableGridTiles;
  counters["far_clipmap_geometry_creates_total"] = stats.geometryCreatesTotal;
  counters["far_clipmap_geometry_disposals_total"] = stats.geometryDisposalsTotal;
  counters["far_clipmap_gpu_owned_cells"] = stats.gpuOwnedCells;
  counters["far_clipmap_gpu_ownership_holes"] = stats.gpuOwnershipHoles;
  counters["far_clipmap_source_ready"] = stats.sourceReady;
  counters["far_clipmap_build_ms"] = stats.buildMsThisFrame;
  counters["far_clipmap_build_ms_total"] = stats.buildMsTotal;
  counters["far_clipmap_vertices_built_this_frame"] = stats.verticesBuiltThisFrame;
  counters["far_clipmap_triangles_built_this_frame"] = stats.trianglesBuiltThisFrame;
  counters["far_clipmap_fallback_samples_this_frame"] = stats.fallbackSamplesThisFrame;
  counters["far_clipmap_fallback_samples_lifetime_total"] = stats.fallbackSamplesTotal;
  counters["far_clipmap_fallback_samples_total"] = fallbackSamplesSinceStreamReady(counters, stats);
  counters["far_clipmap_exception_samples_this_frame"] = stats.exceptionSamplesThisFrame;
  counters["far_clipmap_exception_samples_total"] = stats.exceptionSamplesTotal;
}
