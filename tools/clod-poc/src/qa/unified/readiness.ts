import type { ClodHooks } from "../../core/hooks.js";

const ZERO_COUNTERS = [
  "far_summary_tiles_missing",
  "far_summary_tiles_building",
  "far_shell_rebuild_pending",
  "terrain_texture_window_pending",
  "live_bubble_failed_pages",
  "live_bubble_building_pages",
  "live_bubble_gpu_retry_pages",
  "live_clod_stream_failed_pages",
  "live_clod_stream_safety_pending_pages",
  "live_clod_stream_safety_inflight_pages",
  "live_clod_stream_parent_coverage_violations",
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
  const cacheCapacity = counters["live_clod_stream_safety_cache_capacity_ok"];
  if (typeof cacheCapacity === "number" && cacheCapacity === 0) blockers.push("live_clod_stream_safety_cache_capacity_ok=0");
  return blockers;
}
