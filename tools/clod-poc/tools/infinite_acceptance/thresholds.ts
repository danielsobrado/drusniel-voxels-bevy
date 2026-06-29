export const REQUIRED_COUNTERS = [
  "frame_ms_p95",
  "frame_ms_p99",
  "frame_ms_avg",
  "draw_calls",
  "total_scene_tris",
  "terrain_draw_calls",
  "rendered_terrain_tris",
  "far_shell_enabled",
  "far_shell_tris",
  "far_shell_radius_m",
  "far_shell_grid_res",
  "streamer_far_shell_ownership_ok",
  "ring_boundary_holes",
  "live_clod_gap_holes",
  "clod_far_gap_holes",
  "live_clod_overlap_cells",
  "clod_far_overlap_cells",
  "missing_live_chunks_in_required_radius",
  "missing_clod_pages_in_required_radius",
  "camera_to_clod_center_m",
  "camera_to_far_shell_center_m",
  "far_shell_inner_minus_clod_radius_m",
  "horizon_hole_ratio",
  "far_summary_tiles_required",
  "far_summary_tiles_ready",
  "far_summary_tiles_missing",
  "far_summary_tiles_stale",
] as const;

export type RequiredCounter = typeof REQUIRED_COUNTERS[number];

export interface ThresholdRule {
  key: RequiredCounter;
  label: string;
  pass: (value: number) => boolean;
}

export const THRESHOLD_RULES: ThresholdRule[] = [
  { key: "frame_ms_p95", label: "must be <= 8", pass: (value) => value <= 8 },
  { key: "frame_ms_p99", label: "must be >= 0", pass: (value) => value >= 0 },
  { key: "streamer_far_shell_ownership_ok", label: "must equal 1", pass: (value) => value === 1 },
  { key: "ring_boundary_holes", label: "must equal 0", pass: (value) => value === 0 },
  { key: "live_clod_gap_holes", label: "must equal 0", pass: (value) => value === 0 },
  { key: "clod_far_gap_holes", label: "must equal 0", pass: (value) => value === 0 },
  { key: "live_clod_overlap_cells", label: "must equal 0", pass: (value) => value === 0 },
  { key: "clod_far_overlap_cells", label: "must equal 0", pass: (value) => value === 0 },
  { key: "missing_live_chunks_in_required_radius", label: "must equal 0", pass: (value) => value === 0 },
  { key: "missing_clod_pages_in_required_radius", label: "must equal 0", pass: (value) => value === 0 },
  { key: "camera_to_clod_center_m", label: "must be <= 1", pass: (value) => value <= 1 },
  { key: "camera_to_far_shell_center_m", label: "must be <= 1", pass: (value) => value <= 1 },
  { key: "far_shell_inner_minus_clod_radius_m", label: "must be >= 0", pass: (value) => value >= 0 },
  { key: "horizon_hole_ratio", label: "must equal 0", pass: (value) => value === 0 },
  { key: "far_summary_tiles_missing", label: "must equal 0 after warmup", pass: (value) => value === 0 },
];

export interface ThresholdEvaluation {
  values: Record<string, number>;
  missing: string[];
  failures: string[];
  passed: boolean;
}

export function extractAcceptanceCounters(stats: Record<string, unknown>): Record<string, number> {
  const counters = stats["counters"] as Record<string, unknown> | undefined;
  const out: Record<string, number> = {};
  for (const key of REQUIRED_COUNTERS) {
    const value = counters?.[key] ?? stats[key];
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

export function evaluateThresholds(values: Record<string, number>): ThresholdEvaluation {
  const missing = REQUIRED_COUNTERS.filter((key) => !(key in values));
  const failures: string[] = [];
  for (const key of missing) failures.push(`${key} missing or not numeric`);
  for (const rule of THRESHOLD_RULES) {
    const value = values[rule.key];
    if (value === undefined) continue;
    if (!rule.pass(value)) failures.push(`${rule.key}=${value} failed: ${rule.label}`);
  }
  return {
    values,
    missing,
    failures,
    passed: failures.length === 0,
  };
}
