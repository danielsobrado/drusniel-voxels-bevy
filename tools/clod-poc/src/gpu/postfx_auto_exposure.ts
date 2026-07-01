import { load } from "js-yaml";
import autoExposureYaml from "../environment/config/postfx_auto_exposure.yaml?raw";

export interface PostFxAutoExposureSettings {
  enabled: boolean;
  lock: boolean;
  samplesPerAxis: number;
  targetLuminance: number;
  minExposure: number;
  maxExposure: number;
  adaptationRate: number;
  centerWeightStrength: number;
}

const FALLBACK_AUTO_EXPOSURE: PostFxAutoExposureSettings = {
  enabled: true,
  lock: false,
  samplesPerAxis: 12,
  targetLuminance: 0.1,
  minExposure: 0.18,
  maxExposure: 4.0,
  adaptationRate: 0.07,
  centerWeightStrength: 0.55,
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

function integerValue(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(clamp(finiteNumber(value, fallback), min, max));
}

function positiveNumber(value: unknown, fallback: number): number {
  return Math.max(0.0001, finiteNumber(value, fallback));
}

export function centerMeterWeight(u: number, v: number, strength: number): number {
  const dx = u - 0.5;
  const dy = (v - 0.5) * 0.9;
  return Math.max(0.0001, 1 - clamp(strength, 0, 0.95) * Math.hypot(dx, dy));
}

export function autoExposureWeightTotal(samplesPerAxis: number, centerWeightStrength: number): number {
  let total = 0;
  for (let gy = 0; gy < samplesPerAxis; gy++) {
    for (let gx = 0; gx < samplesPerAxis; gx++) {
      total += centerMeterWeight((gx + 0.5) / samplesPerAxis, (gy + 0.5) / samplesPerAxis, centerWeightStrength);
    }
  }
  return total;
}

export function parsePostFxAutoExposureSettings(yamlText = autoExposureYaml): PostFxAutoExposureSettings {
  try {
    const raw = load(yamlText);
    if (!isRecord(raw)) return FALLBACK_AUTO_EXPOSURE;
    const root = isRecord(raw.postfx_auto_exposure) ? raw.postfx_auto_exposure : raw;
    const minExposure = positiveNumber(root.min_exposure, FALLBACK_AUTO_EXPOSURE.minExposure);
    const maxExposure = Math.max(minExposure, positiveNumber(root.max_exposure, FALLBACK_AUTO_EXPOSURE.maxExposure));
    return {
      enabled: booleanValue(root.enabled, FALLBACK_AUTO_EXPOSURE.enabled),
      lock: booleanValue(root.lock, FALLBACK_AUTO_EXPOSURE.lock),
      samplesPerAxis: integerValue(root.samples_per_axis, FALLBACK_AUTO_EXPOSURE.samplesPerAxis, 2, 24),
      targetLuminance: positiveNumber(root.target_luminance, FALLBACK_AUTO_EXPOSURE.targetLuminance),
      minExposure,
      maxExposure,
      adaptationRate: clamp(finiteNumber(root.adaptation_rate, FALLBACK_AUTO_EXPOSURE.adaptationRate), 0, 1),
      centerWeightStrength: clamp(finiteNumber(root.center_weight_strength, FALLBACK_AUTO_EXPOSURE.centerWeightStrength), 0, 0.95),
    };
  } catch (error) {
    console.warn("[webgpu-post] failed to parse postfx_auto_exposure.yaml; using fallback", error);
    return FALLBACK_AUTO_EXPOSURE;
  }
}

export const DEFAULT_POSTFX_AUTO_EXPOSURE = parsePostFxAutoExposureSettings();
