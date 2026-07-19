import { load } from "js-yaml";
import cloudsYaml from "../environment/config/postfx_clouds.yaml?raw";

export interface PostFxCloudSettings {
  enabled: boolean;
  bottomMeters: number;
  topMeters: number;
  maxDistanceMeters: number;
  steps: number;
  coverage: number;
  density: number;
  windSpeedMetersPerSecond: number;
  absorption: number;
  sunStrength: number;
  ambientStrength: number;
  horizonFade: number;
}

const FALLBACK_CLOUDS: PostFxCloudSettings = {
  enabled: true,
  bottomMeters: 850.0,
  topMeters: 1450.0,
  maxDistanceMeters: 14000.0,
  steps: 32,
  coverage: 0.56,
  density: 0.62,
  windSpeedMetersPerSecond: 18.0,
  absorption: 0.035,
  sunStrength: 1.8,
  ambientStrength: 0.38,
  horizonFade: 0.08,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function positiveNumber(value: unknown, fallback: number): number {
  return Math.max(0.0001, finiteNumber(value, fallback));
}

function integerValue(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(clamp(finiteNumber(value, fallback), min, max));
}

export function parsePostFxCloudSettings(yamlText = cloudsYaml): PostFxCloudSettings {
  try {
    const raw = load(yamlText);
    if (!isRecord(raw)) return FALLBACK_CLOUDS;
    const root = isRecord(raw.postfx_clouds) ? raw.postfx_clouds : raw;
    const bottomMeters = finiteNumber(root.bottom_m, FALLBACK_CLOUDS.bottomMeters);
    const topMeters = Math.max(bottomMeters + 1, finiteNumber(root.top_m, FALLBACK_CLOUDS.topMeters));
    return {
      enabled: booleanValue(root.enabled, FALLBACK_CLOUDS.enabled),
      bottomMeters,
      topMeters,
      maxDistanceMeters: positiveNumber(root.max_distance_m, FALLBACK_CLOUDS.maxDistanceMeters),
      steps: integerValue(root.steps, FALLBACK_CLOUDS.steps, 8, 40),
      coverage: clamp(finiteNumber(root.coverage, FALLBACK_CLOUDS.coverage), 0, 1),
      density: clamp(finiteNumber(root.density, FALLBACK_CLOUDS.density), 0, 4),
      windSpeedMetersPerSecond: finiteNumber(root.wind_speed_mps, FALLBACK_CLOUDS.windSpeedMetersPerSecond),
      absorption: positiveNumber(root.absorption, FALLBACK_CLOUDS.absorption),
      sunStrength: clamp(finiteNumber(root.sun_strength, FALLBACK_CLOUDS.sunStrength), 0, 8),
      ambientStrength: clamp(finiteNumber(root.ambient_strength, FALLBACK_CLOUDS.ambientStrength), 0, 4),
      horizonFade: clamp(finiteNumber(root.horizon_fade, FALLBACK_CLOUDS.horizonFade), 0, 0.45),
    };
  } catch (error) {
    console.warn("[webgpu-post] failed to parse postfx_clouds.yaml; using fallback", error);
    return FALLBACK_CLOUDS;
  }
}

export const DEFAULT_POSTFX_CLOUDS = parsePostFxCloudSettings();
