import type { FarClipmapStats } from "./far_clipmap_controller.js";

export function publishFarClipmapStatsToCounters(counters: Record<string, number>, stats: FarClipmapStats): void {
  counters["far_clipmap_enabled"] = stats.enabled;
  counters["far_clipmap_visible"] = stats.visible;
  counters["far_clipmap_active_rings"] = stats.ringCount;
  counters["far_clipmap_ready_tiles"] = stats.readyTiles;
  counters["far_clipmap_pending_tiles"] = stats.pendingTiles;
  counters["far_clipmap_rebuilt_this_frame"] = stats.rebuiltTilesThisFrame;
  counters["far_clipmap_inner_radius_m"] = stats.innerRadiusM;
  counters["far_clipmap_outer_radius_m"] = stats.outerRadiusM;
  counters["far_clipmap_snap_size_m"] = stats.snapSizeM;
  counters["far_clipmap_gpu_owned_cells"] = stats.gpuOwnedCells;
  counters["far_clipmap_gpu_ownership_holes"] = stats.gpuOwnershipHoles;
  counters["far_clipmap_source_ready"] = stats.sourceReady;
  counters["far_clipmap_build_ms"] = stats.buildMsThisFrame;
  counters["far_clipmap_build_ms_total"] = stats.buildMsTotal;
  counters["far_clipmap_vertices_built_this_frame"] = stats.verticesBuiltThisFrame;
  counters["far_clipmap_triangles_built_this_frame"] = stats.trianglesBuiltThisFrame;
  counters["far_clipmap_fallback_samples_this_frame"] = stats.fallbackSamplesThisFrame;
  counters["far_clipmap_fallback_samples_total"] = stats.fallbackSamplesTotal;
  counters["far_clipmap_exception_samples_this_frame"] = stats.exceptionSamplesThisFrame;
  counters["far_clipmap_exception_samples_total"] = stats.exceptionSamplesTotal;
}
