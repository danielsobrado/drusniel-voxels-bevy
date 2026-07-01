import { load } from "js-yaml";

export interface PostFxPerfThresholds {
  maxFrameP50DeltaMs: number;
  maxFrameP95DeltaMs: number;
  maxRenderP95DeltaMs: number;
}

export interface PostFxPerfGateConfig {
  enabled: boolean;
  baselineCase: string;
  defaultThresholds: PostFxPerfThresholds;
  caseThresholds: Record<string, PostFxPerfThresholds>;
}

export interface PostFxPerfCaseSummary {
  name: string;
  snapshot: {
    metrics?: Record<string, { p50?: number; p95?: number }>;
  };
}

export interface PostFxPerfSummary {
  cases: PostFxPerfCaseSummary[];
}

export interface PostFxPerfGateFailure {
  caseName: string;
  metric: "frameP50" | "frameP95" | "renderP95";
  deltaMs: number;
  thresholdMs: number;
}

export interface PostFxPerfGateResult {
  enabled: boolean;
  baselineCase: string;
  failures: PostFxPerfGateFailure[];
  rows: Array<{
    caseName: string;
    frameP50DeltaMs: number;
    frameP95DeltaMs: number;
    renderP95DeltaMs: number;
    thresholds: PostFxPerfThresholds;
  }>;
}

const DEFAULT_THRESHOLDS: PostFxPerfThresholds = {
  maxFrameP50DeltaMs: 6,
  maxFrameP95DeltaMs: 10,
  maxRenderP95DeltaMs: 10,
};

const DEFAULT_CONFIG: PostFxPerfGateConfig = {
  enabled: true,
  baselineCase: "postfx-off",
  defaultThresholds: DEFAULT_THRESHOLDS,
  caseThresholds: {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function thresholdsFromRecord(value: unknown, fallback: PostFxPerfThresholds): PostFxPerfThresholds {
  if (!isRecord(value)) return fallback;
  return {
    maxFrameP50DeltaMs: Math.max(0, finiteNumber(value.max_frame_p50_delta_ms, fallback.maxFrameP50DeltaMs)),
    maxFrameP95DeltaMs: Math.max(0, finiteNumber(value.max_frame_p95_delta_ms, fallback.maxFrameP95DeltaMs)),
    maxRenderP95DeltaMs: Math.max(0, finiteNumber(value.max_render_p95_delta_ms, fallback.maxRenderP95DeltaMs)),
  };
}

export function parsePostFxPerfGateConfig(yamlText: string): PostFxPerfGateConfig {
  try {
    const raw = load(yamlText);
    if (!isRecord(raw)) return DEFAULT_CONFIG;
    const root = isRecord(raw.postfx_perf_gate) ? raw.postfx_perf_gate : raw;
    const defaultThresholds = thresholdsFromRecord(root.default_thresholds, DEFAULT_THRESHOLDS);
    const caseThresholds: Record<string, PostFxPerfThresholds> = {};
    if (isRecord(root.cases)) {
      for (const [caseName, thresholds] of Object.entries(root.cases)) {
        caseThresholds[caseName] = thresholdsFromRecord(thresholds, defaultThresholds);
      }
    }
    return {
      enabled: booleanValue(root.enabled, DEFAULT_CONFIG.enabled),
      baselineCase: stringValue(root.baseline_case, DEFAULT_CONFIG.baselineCase),
      defaultThresholds,
      caseThresholds,
    };
  } catch (error) {
    console.warn("[postfx-perf-gate] failed to parse config; using defaults", error);
    return DEFAULT_CONFIG;
  }
}

function metric(caseSummary: PostFxPerfCaseSummary, metricName: string, statName: "p50" | "p95"): number {
  return Number(caseSummary.snapshot.metrics?.[metricName]?.[statName] ?? 0);
}

function failure(
  caseName: string,
  metricName: PostFxPerfGateFailure["metric"],
  deltaMs: number,
  thresholdMs: number,
): PostFxPerfGateFailure | null {
  return deltaMs > thresholdMs ? { caseName, metric: metricName, deltaMs, thresholdMs } : null;
}

export function evaluatePostFxPerfGate(summary: PostFxPerfSummary, config: PostFxPerfGateConfig): PostFxPerfGateResult {
  if (!config.enabled) return { enabled: false, baselineCase: config.baselineCase, failures: [], rows: [] };
  const baseline = summary.cases.find((entry) => entry.name === config.baselineCase);
  if (!baseline) {
    return {
      enabled: true,
      baselineCase: config.baselineCase,
      failures: [{ caseName: config.baselineCase, metric: "frameP50", deltaMs: Number.POSITIVE_INFINITY, thresholdMs: 0 }],
      rows: [],
    };
  }

  const baseFrameP50 = metric(baseline, "frameMs", "p50");
  const baseFrameP95 = metric(baseline, "frameMs", "p95");
  const baseRenderP95 = metric(baseline, "renderMs", "p95");
  const failures: PostFxPerfGateFailure[] = [];
  const rows: PostFxPerfGateResult["rows"] = [];

  for (const entry of summary.cases) {
    if (entry.name === config.baselineCase) continue;
    const thresholds = config.caseThresholds[entry.name] ?? config.defaultThresholds;
    const row = {
      caseName: entry.name,
      frameP50DeltaMs: metric(entry, "frameMs", "p50") - baseFrameP50,
      frameP95DeltaMs: metric(entry, "frameMs", "p95") - baseFrameP95,
      renderP95DeltaMs: metric(entry, "renderMs", "p95") - baseRenderP95,
      thresholds,
    };
    rows.push(row);
    for (const maybeFailure of [
      failure(entry.name, "frameP50", row.frameP50DeltaMs, thresholds.maxFrameP50DeltaMs),
      failure(entry.name, "frameP95", row.frameP95DeltaMs, thresholds.maxFrameP95DeltaMs),
      failure(entry.name, "renderP95", row.renderP95DeltaMs, thresholds.maxRenderP95DeltaMs),
    ]) {
      if (maybeFailure) failures.push(maybeFailure);
    }
  }

  return { enabled: true, baselineCase: config.baselineCase, failures, rows };
}
