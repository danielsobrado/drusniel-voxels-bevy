export type QaTarget = "clod-poc" | "bevy";
export type QaLane = "static" | "gpu" | "full";
export type GateEnforcement = "required" | "advisory";

export interface QaCameraConfig {
  position: [number, number, number];
  yaw_deg: number;
  pitch_deg: number;
  fov_y_deg: number;
}

export interface QaLightingConfig {
  time_of_day_hours: number;
  sun_elevation_deg: number;
  sun_azimuth_deg: number;
}

export interface QaWeatherConfig {
  wind_time_s: number;
  cloud_time_s: number;
  particle_time_s: number;
  precipitation: string;
}

export interface QaLaunchConfig {
  world_seed: number;
  world_mode: string;
  scene: string;
  quality: string;
  render_resolution_preset: string;
  viewport: [number, number];
  device_pixel_ratio: number;
  camera: QaCameraConfig;
  lighting: QaLightingConfig;
  weather: QaWeatherConfig;
  flags: Record<string, string | number | boolean>;
}

export interface QaSettleConfig {
  ready_timeout_ms: number;
  warmup_frames: number;
  settle_frames: number;
  freeze_after_settle: boolean;
}

export interface QaCaptureConfig {
  checkpoint: string;
  image: string;
  include_hud: boolean;
  include_debug_overlays: boolean;
}

export interface QaBaselineConfig {
  image: string;
  stats: string;
  metrics: string;
  mask: string | null;
  sha256: string | null;
}

export interface QaImageGates {
  required: boolean;
  changed_pixel_threshold: number;
  mean_absolute_error_max: number;
  p95_absolute_error_max: number;
  changed_pixel_fraction_max: number;
  edge_error_mean_max: number;
  luminance_mean_delta_max: number;
  luminance_stddev_delta_max: number;
  chroma_mean_delta_max: number;
}

export interface NumericRangeGate {
  min?: number;
  max?: number;
}

export interface QaRegionProbe {
  id: string;
  rect_normalized: [number, number, number, number];
  gates: {
    luminance_mean?: NumericRangeGate;
    luminance_stddev?: NumericRangeGate;
    chroma_mean?: NumericRangeGate;
    black_pixel_fraction?: NumericRangeGate;
    clipped_pixel_fraction?: NumericRangeGate;
    edge_magnitude?: NumericRangeGate;
  };
}

export interface QaTimingGate {
  id: string;
  metric: string;
  max: number;
  enforcement: GateEnforcement;
  required: boolean;
}

export type CounterOperator = "equals" | "min" | "max" | "between";

export interface QaCounterGate {
  id: string;
  key: string;
  operator: CounterOperator;
  value?: number;
  range?: [number, number];
  required: boolean;
}

export interface QaInformationalMetric {
  id: string;
  key: string;
  required: false;
}

export interface UnifiedQaScene {
  id: string;
  target: QaTarget;
  lane: QaLane;
  enabled: boolean;
  tags: string[];
  launch: QaLaunchConfig;
  settle: QaSettleConfig;
  capture: QaCaptureConfig;
  baseline: QaBaselineConfig;
  image_gates: QaImageGates;
  region_probes: QaRegionProbe[];
  timing_gates: QaTimingGate[];
  counter_gates: QaCounterGate[];
  informational_metrics: QaInformationalMetric[];
  specialized_commands: string[];
}

export interface VisualRegressionManifest {
  schema_version: 1;
  baseline_version: number;
  default_target: QaTarget;
  output_root: string;
  scenes: UnifiedQaScene[];
}

export interface PerformanceRegressionManifest {
  schema_version: 1;
  default_target: QaTarget;
  output_root: string;
  scenes: UnifiedQaScene[];
}

export interface UnifiedQaRegistry {
  schemaVersion: 1;
  baselineVersion: number;
  outputRoot: string;
  scenes: UnifiedQaScene[];
}

export interface LegacyIdMapEntry {
  legacy: string;
  canonical: string;
  kind: "scene" | "probe" | "timing" | "counter" | "informational";
}
