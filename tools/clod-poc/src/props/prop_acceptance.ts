export interface PropAcceptanceSceneThresholds {
  min_instances_total?: number;
  max_update_ms?: number;
  max_draw_calls?: number;
  min_cells_culled?: number;
  min_instances_visible?: number;
  max_frame_ms?: number;
}

export interface PropAcceptanceConfig {
  scenes: Record<string, PropAcceptanceSceneThresholds>;
}

export interface PropAcceptanceFailure {
  scene: string;
  metric: string;
  actual: number;
  expected: string;
}

export function validatePropShotStats(
  scene: string,
  stats: { frameMs?: number; counters?: Record<string, number> },
  config: PropAcceptanceConfig,
): PropAcceptanceFailure[] {
  const thresholds = config.scenes[scene];
  if (!thresholds) return [];

  const counters = stats.counters ?? {};
  const failures: PropAcceptanceFailure[] = [];
  const check = (metric: string, actual: number, ok: boolean, expected: string) => {
    if (!ok) failures.push({ scene, metric, actual, expected });
  };

  if (thresholds.min_instances_total !== undefined) {
    const actual = counters["props.instances_total"] ?? 0;
    check("props.instances_total", actual, actual >= thresholds.min_instances_total, `>= ${thresholds.min_instances_total}`);
  }
  if (thresholds.min_instances_visible !== undefined) {
    const actual = counters["props.instances_visible"] ?? 0;
    check("props.instances_visible", actual, actual >= thresholds.min_instances_visible, `>= ${thresholds.min_instances_visible}`);
  }
  if (thresholds.max_update_ms !== undefined) {
    const actual = counters["props.update_ms"] ?? 0;
    check("props.update_ms", actual, actual <= thresholds.max_update_ms, `<= ${thresholds.max_update_ms}`);
  }
  if (thresholds.max_draw_calls !== undefined) {
    const actual = counters["props.draw_calls"] ?? 0;
    check("props.draw_calls", actual, actual <= thresholds.max_draw_calls, `<= ${thresholds.max_draw_calls}`);
  }
  if (thresholds.min_cells_culled !== undefined) {
    const actual = counters["props.cells_culled"] ?? 0;
    check("props.cells_culled", actual, actual >= thresholds.min_cells_culled, `>= ${thresholds.min_cells_culled}`);
  }
  if (thresholds.max_frame_ms !== undefined) {
    const actual = stats.frameMs ?? 0;
    check("frameMs", actual, actual <= thresholds.max_frame_ms, `<= ${thresholds.max_frame_ms}`);
  }

  return failures;
}
