import type { Phase0Config } from "./phase0_config.js";

export interface Phase0Metrics {
  world_cells: number;
  target_visible_m: number;
  effective_far_radius_m: number;
  effective_visible_m: number;
  visible_target_met: boolean;
  far_shell_enabled: boolean;
  far_shell_tris: number;
  far_shell_radius_m: number;
  far_shell_grid_res: number;
  shadow_proxy_enabled: boolean;
  shadow_proxy_inert: number;
  shadow_proxy_tris: number;
  canopy_enabled: boolean;
  canopy_tris: number;
  built_page_count_lod0: number;
  built_page_count_lod1: number;
  built_page_count_lod2: number;
  built_page_count_lod3: number;
  rendered_page_count_lod0: number;
  rendered_page_count_lod1: number;
  rendered_page_count_lod2: number;
  rendered_page_count_lod3: number;
  rendered_terrain_tris: number;
  total_scene_tris: number;
  draw_calls: number;
  frame_ms_avg: number;
  frame_ms_p95: number;
  frame_ms_p99: number;
  streamer_simulated_required_chunks: number;
  streamer_simulated_required_pages: number;
  streamer_simulated_missing_chunks: number;
  streamer_simulated_missing_pages: number;
  horizon_hole_ratio: number;
  stale_fallback_count: number;
}

export interface Phase0SceneReport {
  scene: string;
  config_hash: string;
  timestamp: string;
  metrics: Phase0Metrics;
  required_counters_present: boolean;
  missing_counters: string[];
}

export interface Phase0AcceptanceResult {
  scene: string;
  visible_target_met: boolean;
  horizon_hole_ratio_ok: boolean;
  streamer_missing_chunks_ok: boolean;
  streamer_missing_pages_ok: boolean;
  all_counters_present: boolean;
  missing_counters: string[];
  passed: boolean;
}

export function computeEffectiveVisibleMeters(input: {
  worldCells: number;
  farShellEnabled: boolean;
  farShellRadiusM: number;
}): number {
  if (!input.farShellEnabled) {
    return input.worldCells;
  }
  return input.farShellRadiusM;
}

export function computeVisibleTargetMet(input: {
  effectiveVisibleM: number;
  targetVisibleM: number;
}): boolean {
  return input.effectiveVisibleM >= input.targetVisibleM;
}

export function summarizeAcceptance(input: {
  metrics: Phase0Metrics;
  config: Phase0Config;
  sceneName: string;
}): Phase0AcceptanceResult {
  const { metrics, config, sceneName } = input;
  const missing = config.metrics.required_counters.filter((k) => !(k in metrics));

  const visible_target_met = computeVisibleTargetMet({
    effectiveVisibleM: metrics.effective_visible_m,
    targetVisibleM: metrics.target_visible_m,
  });

  const horizon_hole_ratio_ok = metrics.horizon_hole_ratio === -1
    ? true
    : metrics.horizon_hole_ratio <= config.acceptance.max_horizon_hole_ratio;

  const streamer_missing_chunks_ok =
    metrics.streamer_simulated_missing_chunks <= config.acceptance.max_streamer_simulated_missing_chunks;

  const streamer_missing_pages_ok =
    metrics.streamer_simulated_missing_pages <= config.acceptance.max_streamer_simulated_missing_pages;

  const all_counters_present = missing.length === 0;

  const passed = (visible_target_met || config.acceptance.allow_current_4km_failure)
    && horizon_hole_ratio_ok
    && streamer_missing_chunks_ok
    && streamer_missing_pages_ok
    && all_counters_present;

  return {
    scene: sceneName,
    visible_target_met,
    horizon_hole_ratio_ok,
    streamer_missing_chunks_ok,
    streamer_missing_pages_ok,
    all_counters_present,
    missing_counters: missing,
    passed,
  };
}

export function buildDefaultMetrics(): Phase0Metrics {
  return {
    world_cells: 0,
    target_visible_m: 0,
    effective_far_radius_m: 0,
    effective_visible_m: 0,
    visible_target_met: false,
    far_shell_enabled: false,
    far_shell_tris: 0,
    far_shell_radius_m: 0,
    far_shell_grid_res: 0,
    shadow_proxy_enabled: false,
    shadow_proxy_inert: 0,
    shadow_proxy_tris: 0,
    canopy_enabled: false,
    canopy_tris: 0,
    built_page_count_lod0: 0,
    built_page_count_lod1: 0,
    built_page_count_lod2: 0,
    built_page_count_lod3: 0,
    rendered_page_count_lod0: 0,
    rendered_page_count_lod1: 0,
    rendered_page_count_lod2: 0,
    rendered_page_count_lod3: 0,
    rendered_terrain_tris: 0,
    total_scene_tris: 0,
    draw_calls: 0,
    frame_ms_avg: 0,
    frame_ms_p95: -1,
    frame_ms_p99: -1,
    streamer_simulated_required_chunks: 0,
    streamer_simulated_required_pages: 0,
    streamer_simulated_missing_chunks: 0,
    streamer_simulated_missing_pages: 0,
    horizon_hole_ratio: -1,
    stale_fallback_count: 0,
  };
}
