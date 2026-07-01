import { load } from "js-yaml";
import bounceYaml from "../environment/config/postfx_bounce.yaml?raw";

export interface PostFxBounceSettings {
  enabled: boolean;
  strength: number;
  radiusMeters: number;
  maxDistanceMeters: number;
  depthToleranceMeters: number;
  minUvRadius: number;
  maxUvRadius: number;
  taps: number;
}

const FALLBACK_BOUNCE: PostFxBounceSettings = {
  enabled: false,
  strength: 0.16,
  radiusMeters: 0.55,
  maxDistanceMeters: 180.0,
  depthToleranceMeters: 1.8,
  minUvRadius: 0.004,
  maxUvRadius: 0.07,
  taps: 8,
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

export function projectedBounceRadiusUv(radiusMeters: number, distanceMeters: number, minUvRadius: number, maxUvRadius: number): number {
  return clamp(radiusMeters / Math.max(0.0001, distanceMeters), minUvRadius, maxUvRadius);
}

export function parsePostFxBounceSettings(yamlText = bounceYaml): PostFxBounceSettings {
  try {
    const raw = load(yamlText);
    if (!isRecord(raw)) return FALLBACK_BOUNCE;
    const root = isRecord(raw.postfx_bounce) ? raw.postfx_bounce : raw;
    const minUvRadius = positiveNumber(root.min_uv_radius, FALLBACK_BOUNCE.minUvRadius);
    const maxUvRadius = Math.max(minUvRadius, positiveNumber(root.max_uv_radius, FALLBACK_BOUNCE.maxUvRadius));
    return {
      enabled: booleanValue(root.enabled, FALLBACK_BOUNCE.enabled),
      strength: clamp(finiteNumber(root.strength, FALLBACK_BOUNCE.strength), 0, 1),
      radiusMeters: positiveNumber(root.radius_m, FALLBACK_BOUNCE.radiusMeters),
      maxDistanceMeters: positiveNumber(root.max_distance_m, FALLBACK_BOUNCE.maxDistanceMeters),
      depthToleranceMeters: positiveNumber(root.depth_tolerance_m, FALLBACK_BOUNCE.depthToleranceMeters),
      minUvRadius,
      maxUvRadius,
      taps: integerValue(root.taps, FALLBACK_BOUNCE.taps, 2, 16),
    };
  } catch (error) {
    console.warn("[webgpu-post] failed to parse postfx_bounce.yaml; using fallback", error);
    return FALLBACK_BOUNCE;
  }
}

export const DEFAULT_POSTFX_BOUNCE = parsePostFxBounceSettings();
