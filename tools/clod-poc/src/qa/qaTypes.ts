export type Status = "pass" | "fail" | "baseline_missing" | "missing_optional";

export interface QaConfigFile {
  qa: QaConfig;
}

export interface QaConfig {
  output_root?: string;
  baseline_root?: string;
  report_json_name?: string;
  report_markdown_name?: string;
  image_diff?: ImageDiffConfig;
  timing?: TimingConfig;
  scenes: QaSceneConfig[];
}

export interface ImageDiffConfig {
  enabled?: boolean;
  fail_when_baseline_missing?: boolean;
  max_changed_ratio?: number;
  max_rmse?: number;
  max_mean_abs_error?: number;
}

export interface TimingConfig {
  enabled?: boolean;
  fail_on_threshold?: boolean;
}

export interface QaSceneConfig {
  id: string;
  bench_scene?: string;
  checkpoint: string;
  screenshots: QaScreenshotConfig[];
  probes?: QaProbeConfig[];
  timing?: QaTimingThreshold[];
  checks?: QaCheckThreshold[];
  optional?: boolean;
}

export interface QaScreenshotConfig {
  id: string;
  name: string;
  baseline?: string;
}

export type QaProbeConfig =
  | {
      id: string;
      type: "region_luminance";
      screenshot: string;
      region: [number, number, number, number];
      min: number;
      max: number;
    }
  | {
      id: string;
      type: "region_variance";
      screenshot: string;
      region: [number, number, number, number];
      min_luminance_stddev: number;
    }
  | {
      id: string;
      type: "pixel_luminance";
      screenshot: string;
      pixel: [number, number];
      min: number;
      max: number;
    };

export interface QaTimingThreshold {
  id: string;
  area: string;
  field: string;
  max_ms: number;
  optional?: boolean;
}

export interface QaCheckThreshold {
  id: string;
  area: string;
  field: string;
  max?: number;
  min?: number;
  equals?: number;
  optional?: boolean;
}

export interface WebQaSummary {
  scene: string;
  git_sha?: string | null;
  git_dirty?: boolean | null;
  build_profile?: string;
  platform?: string;
  run_started_utc?: string;
  duration_secs?: number;
  checkpoints: WebQaCheckpoint[];
}

export interface WebQaCheckpoint {
  name: string;
  median_frame_ms?: number;
  p95_frame_ms?: number;
  p99_frame_ms?: number;
  areas?: Record<string, Record<string, number>>;
  screenshots?: WebQaScreenshot[];
}

export interface WebQaScreenshot {
  id?: string;
  name: string;
  path?: string;
  metrics?: {
    luminance_mean?: number;
    luminance_stddev?: number;
    regions?: Record<string, {
      luminance_mean?: number;
      luminance_stddev?: number;
    }>;
    pixels?: Record<string, number>;
  };
  diff?: {
    changed_ratio?: number;
    rmse?: number;
    mean_abs_error?: number;
  };
}

export interface QaReport {
  schema_version: number;
  overall_status: Status;
  summary_path: string;
  bench: Record<string, unknown>;
  scenes: QaSceneReport[];
  failures: string[];
}

export interface QaSceneReport {
  id: string;
  checkpoint: string;
  status: Status;
  screenshots: QaScreenshotReport[];
  probes: QaProbeResult[];
  timing: QaTimingResult[];
  checks: QaCheckResult[];
  failures: string[];
}

export interface QaScreenshotReport {
  id: string;
  name: string;
  path: string;
  status: Status;
  baseline_path?: string;
  failure?: string;
}

export interface QaProbeResult {
  id: string;
  probe_type: string;
  screenshot: string;
  status: Status;
  observed?: number;
  expected: string;
  failure?: string;
}

export interface QaTimingResult {
  id: string;
  area: string;
  field: string;
  status: Status;
  observed_ms?: number;
  max_ms: number;
  failure?: string;
}

export interface QaCheckResult {
  id: string;
  area: string;
  field: string;
  status: Status;
  observed?: number;
  expected: string;
  failure?: string;
}

export interface CliArgs {
  visual: string;
  performance: string;
  legacyMap: string;
  summary: string;
  output?: string;
  tags: string[];
  scenes: string[];
  actualRoot?: string;
}
