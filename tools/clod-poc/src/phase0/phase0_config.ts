import { load } from "js-yaml";

export interface Phase0SceneCameraConfig {
  mode: string;
  x_ratio?: number;
  z_ratio?: number;
  y_offset_m?: number;
  look_distance_m?: number;
  start_x_ratio?: number;
  start_z_ratio?: number;
  direction_degrees?: number;
  speed_mps?: number;
  duration_seconds?: number;
  turn_degrees_per_second?: number;
}

export interface Phase0SceneConfig {
  world: number;
  camera: Phase0SceneCameraConfig;
  require_visible_m?: number;
  require_canopy_metrics?: boolean;
  scripted_edits?: boolean;
  simulated_streaming_only?: boolean;
}

export interface Phase0StreamingConfig {
  preload_seconds: number;
  live_radius_m: number;
  clod_radius_m: number;
}

export interface Phase0Settings {
  target_visible_m: number;
  target_future_visible_m: number;
  streaming: Phase0StreamingConfig;
  scenes: Record<string, Phase0SceneConfig>;
}

export interface Phase0MetricsSettings {
  required_counters: string[];
}

export interface Phase0AcceptanceSettings {
  allow_current_4km_failure: boolean;
  visible_target_required_for_future_phases: boolean;
  max_horizon_hole_ratio: number;
  max_streamer_simulated_missing_chunks: number;
  max_streamer_simulated_missing_pages: number;
}

export interface Phase0Config {
  phase0: Phase0Settings;
  metrics: Phase0MetricsSettings;
  acceptance: Phase0AcceptanceSettings;
}

function requireNumber(value: unknown, path: string, min?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Phase0 config: expected number at ${path}, got ${String(value)}`);
  }
  if (min !== undefined && value < min) {
    throw new Error(`Phase0 config: ${path} must be >= ${min}, got ${value}`);
  }
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new Error(`Phase0 config: expected string at ${path}, got ${String(value)}`);
  }
  return value;
}

function parseSceneConfig(raw: Record<string, unknown>, path: string): Phase0SceneConfig {
  const world = requireNumber(raw["world"], `${path}.world`, 1);
  const rawCamera = raw["camera"];
  if (!rawCamera || typeof rawCamera !== "object") {
    throw new Error(`Phase0 config: expected camera object at ${path}.camera`);
  }
  const cam = rawCamera as Record<string, unknown>;
  const camera: Phase0SceneCameraConfig = {
    mode: requireString(cam["mode"], `${path}.camera.mode`),
  };
  if (cam["x_ratio"] !== undefined) camera.x_ratio = requireNumber(cam["x_ratio"], `${path}.camera.x_ratio`);
  if (cam["z_ratio"] !== undefined) camera.z_ratio = requireNumber(cam["z_ratio"], `${path}.camera.z_ratio`);
  if (cam["y_offset_m"] !== undefined) camera.y_offset_m = requireNumber(cam["y_offset_m"], `${path}.camera.y_offset_m`);
  if (cam["look_distance_m"] !== undefined) camera.look_distance_m = requireNumber(cam["look_distance_m"], `${path}.camera.look_distance_m`);
  if (cam["start_x_ratio"] !== undefined) camera.start_x_ratio = requireNumber(cam["start_x_ratio"], `${path}.camera.start_x_ratio`);
  if (cam["start_z_ratio"] !== undefined) camera.start_z_ratio = requireNumber(cam["start_z_ratio"], `${path}.camera.start_z_ratio`);
  if (cam["direction_degrees"] !== undefined) camera.direction_degrees = requireNumber(cam["direction_degrees"], `${path}.camera.direction_degrees`);
  if (cam["speed_mps"] !== undefined) camera.speed_mps = requireNumber(cam["speed_mps"], `${path}.camera.speed_mps`);
  if (cam["duration_seconds"] !== undefined) camera.duration_seconds = requireNumber(cam["duration_seconds"], `${path}.camera.duration_seconds`);
  if (cam["turn_degrees_per_second"] !== undefined) camera.turn_degrees_per_second = requireNumber(cam["turn_degrees_per_second"], `${path}.camera.turn_degrees_per_second`);

  const scene: Phase0SceneConfig = { world, camera };
  if (raw["require_visible_m"] !== undefined) {
    scene.require_visible_m = requireNumber(raw["require_visible_m"], `${path}.require_visible_m`, 1);
  }
  if (raw["require_canopy_metrics"] !== undefined) scene.require_canopy_metrics = Boolean(raw["require_canopy_metrics"]);
  if (raw["scripted_edits"] !== undefined) scene.scripted_edits = Boolean(raw["scripted_edits"]);
  if (raw["simulated_streaming_only"] !== undefined) scene.simulated_streaming_only = Boolean(raw["simulated_streaming_only"]);
  return scene;
}

export function parsePhase0Config(rawYaml: string): Phase0Config {
  const raw = load(rawYaml) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    throw new Error("Phase0 config: root must be an object");
  }

  const rawPhase0 = raw["phase0"];
  if (!rawPhase0 || typeof rawPhase0 !== "object") {
    throw new Error("Phase0 config: missing 'phase0' section");
  }
  const p0 = rawPhase0 as Record<string, unknown>;
  const target_visible_m = requireNumber(p0["target_visible_m"], "phase0.target_visible_m", 1);
  const target_future_visible_m = requireNumber(p0["target_future_visible_m"], "phase0.target_future_visible_m", 1);
  if (target_future_visible_m < target_visible_m) {
    throw new Error(`Phase0 config: phase0.target_future_visible_m (${target_future_visible_m}) must be >= phase0.target_visible_m (${target_visible_m})`);
  }

  const rawStreaming = p0["streaming"];
  if (!rawStreaming || typeof rawStreaming !== "object") {
    throw new Error("Phase0 config: missing 'phase0.streaming' section");
  }
  const st = rawStreaming as Record<string, unknown>;
  const streaming: Phase0StreamingConfig = {
    preload_seconds: requireNumber(st["preload_seconds"], "phase0.streaming.preload_seconds", 0.1),
    live_radius_m: requireNumber(st["live_radius_m"], "phase0.streaming.live_radius_m", 1),
    clod_radius_m: requireNumber(st["clod_radius_m"], "phase0.streaming.clod_radius_m", 1),
  };

  const rawScenes = p0["scenes"];
  if (!rawScenes || typeof rawScenes !== "object") {
    throw new Error("Phase0 config: missing 'phase0.scenes' section");
  }
  const scenes: Record<string, Phase0SceneConfig> = {};
  for (const [key, val] of Object.entries(rawScenes as Record<string, unknown>)) {
    if (!val || typeof val !== "object") {
      throw new Error(`Phase0 config: scene '${key}' must be an object`);
    }
    scenes[key] = parseSceneConfig(val as Record<string, unknown>, `phase0.scenes.${key}`);
  }

  const rawMetrics = raw["metrics"];
  if (!rawMetrics || typeof rawMetrics !== "object") {
    throw new Error("Phase0 config: missing 'metrics' section");
  }
  const m = rawMetrics as Record<string, unknown>;
  const rawCounters = m["required_counters"];
  if (!Array.isArray(rawCounters) || rawCounters.length === 0) {
    throw new Error("Phase0 config: metrics.required_counters must be a non-empty array");
  }
  const required_counters: string[] = rawCounters.map((c, i) => {
    if (typeof c !== "string") {
      throw new Error(`Phase0 config: metrics.required_counters[${i}] must be a string`);
    }
    return c;
  });

  const rawAcceptance = raw["acceptance"];
  if (!rawAcceptance || typeof rawAcceptance !== "object") {
    throw new Error("Phase0 config: missing 'acceptance' section");
  }
  const a = rawAcceptance as Record<string, unknown>;
  const acceptance: Phase0AcceptanceSettings = {
    allow_current_4km_failure: Boolean(a["allow_current_4km_failure"]),
    visible_target_required_for_future_phases: Boolean(a["visible_target_required_for_future_phases"]),
    max_horizon_hole_ratio: requireNumber(a["max_horizon_hole_ratio"], "acceptance.max_horizon_hole_ratio", 0),
    max_streamer_simulated_missing_chunks: requireNumber(a["max_streamer_simulated_missing_chunks"], "acceptance.max_streamer_simulated_missing_chunks", 0),
    max_streamer_simulated_missing_pages: requireNumber(a["max_streamer_simulated_missing_pages"], "acceptance.max_streamer_simulated_missing_pages", 0),
  };

  return {
    phase0: { target_visible_m, target_future_visible_m, streaming, scenes },
    metrics: { required_counters },
    acceptance,
  };
}
