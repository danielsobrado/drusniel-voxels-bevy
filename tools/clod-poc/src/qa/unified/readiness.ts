import type { ClodHooks } from "../../core/hooks.js";

const ZERO_COUNTERS = [
  "far_summary_tiles_missing",
  "far_summary_tiles_building",
  "far_shell_rebuild_pending",
  "terrain_texture_window_pending",
  "live_bubble_failed_pages",
  "live_bubble_building_pages",
  "live_bubble_gpu_retry_pages",
  "live_bubble_pending_chunks",
  "live_bubble_inflight_chunks",
  "live_clod_stream_failed_pages",
  "live_clod_stream_pending_pages",
  "live_clod_stream_inflight_batches",
  "live_clod_stream_apply_queue_pages",
  "live_clod_stream_safety_pending_pages",
  "live_clod_stream_safety_inflight_pages",
  "live_clod_stream_refinement_pending_pages",
  "live_clod_stream_refinement_inflight_pages",
  "live_clod_stream_parent_coverage_violations",
  "hydrology_tile_remote_inflight",
  "scene_compile_warm_pending",
  "shadow_proxy_building",
] as const;

export function readinessBlockers(hooks: ClodHooks | undefined): string[] {
  if (!hooks) return ["window.__drusnielClod is missing"];
  if (hooks.error) return [`runtime error: ${hooks.error}`];
  if (!hooks.ready) return [`runtime not ready: ${hooks.progressMsg}`];
  const counters = hooks.stats?.counters;
  if (!counters) return ["runtime stats are missing"];
  const blockers: string[] = [];
  for (const key of ZERO_COUNTERS) {
    const value = counters[key];
    if (typeof value === "number" && value !== 0) blockers.push(`${key}=${value}`);
  }
  requireAtLeast(counters, blockers, "far_summary_tiles_ready", "far_summary_tiles_required");
  requireAtLeast(counters, blockers, "live_bubble_ready_pages", "live_bubble_required_pages");
  requireAtLeast(counters, blockers, "live_clod_stream_safety_ready_pages", "live_clod_stream_safety_required_pages");
  const hydrologyActive = counters["hydrology_atlas_active"];
  if (hydrologyActive === 1) requireAtLeast(counters, blockers, "hydrology_atlas_filled_tiles", "hydrology_atlas_total_tiles");
  const cacheCapacity = counters["live_clod_stream_safety_cache_capacity_ok"];
  if (typeof cacheCapacity === "number" && cacheCapacity === 0) blockers.push("live_clod_stream_safety_cache_capacity_ok=0");
  const compileRequired = counters["scene_compile_warm_required"];
  const compileReady = counters["scene_compile_warm_ready"];
  if (compileRequired === 1 && compileReady !== 1) blockers.push(`scene_compile_warm_ready=${String(compileReady ?? "missing")}`);
  return blockers;
}

function requireAtLeast(
  counters: Record<string, number>,
  blockers: string[],
  readyKey: string,
  requiredKey: string,
): void {
  const ready = counters[readyKey];
  const required = counters[requiredKey];
  if (typeof ready !== "number" || typeof required !== "number" || required <= 0) return;
  if (ready < required) blockers.push(`${readyKey}=${ready}<${requiredKey}=${required}`);
}
