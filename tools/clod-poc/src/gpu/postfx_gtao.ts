import { load } from "js-yaml";
import gtaoYaml from "../environment/config/postfx_gtao.yaml?raw";

export interface PostFxGtaoSettings {
  enabled: boolean;
  samples: number;
  radiusMeters: number;
  strength: number;
  maxDistanceMeters: number;
  fadeEndMeters: number;
  depthBiasMeters: number;
  depthToleranceMeters: number;
  minUvRadius: number;
  maxUvRadius: number;
}

const FALLBACK_GTAO: PostFxGtaoSettings = {
  enabled: false,
  samples: 8,
  radiusMeters: 1.6,
  strength: 0.55,
  maxDistanceMeters: 700.0,
  fadeEndMeters: 1800.0,
  depthBiasMeters: 0.05,
  depthToleranceMeters: 1.2,
  minUvRadius: 0.002,
  maxUvRadius: 0.035,
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

function nonNegativeNumber(value: unknown, fallback: number): number {
  return Math.max(0, finiteNumber(value, fallback));
}

function integerValue(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(clamp(finiteNumber(value, fallback), min, max));
}

export function projectedGtaoRadiusUv(radiusMeters: number, distanceMeters: number, minUvRadius: number, maxUvRadius: number): number {
  return clamp(radiusMeters / Math.max(0.0001, distanceMeters), minUvRadius, maxUvRadius);
}

export function parsePostFxGtaoSettings(yamlText = gtaoYaml): PostFxGtaoSettings {
  try {
    const raw = load(yamlText);
    if (!isRecord(raw)) return FALLBACK_GTAO;
    const root = isRecord(raw.postfx_gtao) ? raw.postfx_gtao : raw;
    const minUvRadius = positiveNumber(root.min_uv_radius, FALLBACK_GTAO.minUvRadius);
    const maxUvRadius = Math.max(minUvRadius, positiveNumber(root.max_uv_radius, FALLBACK_GTAO.maxUvRadius));
    const maxDistanceMeters = positiveNumber(root.max_distance_m, FALLBACK_GTAO.maxDistanceMeters);
    return {
      enabled: booleanValue(root.enabled, FALLBACK_GTAO.enabled),
      samples: integerValue(root.samples, FALLBACK_GTAO.samples, 2, 16),
      radiusMeters: positiveNumber(root.radius_m, FALLBACK_GTAO.radiusMeters),
      strength: clamp(finiteNumber(root.strength, FALLBACK_GTAO.strength), 0, 1),
      maxDistanceMeters,
      fadeEndMeters: Math.max(maxDistanceMeters, positiveNumber(root.fade_end_m, FALLBACK_GTAO.fadeEndMeters)),
      depthBiasMeters: nonNegativeNumber(root.depth_bias_m, FALLBACK_GTAO.depthBiasMeters),
      depthToleranceMeters: positiveNumber(root.depth_tolerance_m, FALLBACK_GTAO.depthToleranceMeters),
      minUvRadius,
      maxUvRadius,
    };
  } catch (error) {
    console.warn("[webgpu-post] failed to parse postfx_gtao.yaml; using fallback", error);
    return FALLBACK_GTAO;
  }
}

export const DEFAULT_POSTFX_GTAO = parsePostFxGtaoSettings();
