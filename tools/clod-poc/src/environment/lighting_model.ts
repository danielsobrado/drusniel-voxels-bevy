import * as THREE from "three";
import { load } from "js-yaml";
import lightingModelYaml from "./config/lighting_model.yaml?raw";
import type {
  EnvironmentColors,
  EnvironmentLighting,
  EnvironmentSettings,
} from "./environment.js";

export interface EnvironmentLightingModelSettings {
  directScale: number;
  skyAmbientScale: number;
  groundAmbientScale: number;
  ambientFloor: number;
  horizonFadeStart: number;
  horizonFadeEnd: number;
  extinctionRgb: [number, number, number];
}

const FALLBACK_LIGHTING_MODEL: EnvironmentLightingModelSettings = {
  directScale: 2.6,
  skyAmbientScale: 0.18,
  groundAmbientScale: 0.08,
  ambientFloor: 0.025,
  horizonFadeStart: -0.04,
  horizonFadeEnd: 0.06,
  extinctionRgb: [0.06, 0.12, 0.28],
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finite(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nonNegative(value: unknown, fallback: number): number {
  return Math.max(0, finite(value, fallback));
}

function rgb(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) return fallback;
  const parsed = value.map(Number);
  return parsed.every(Number.isFinite)
    ? [Math.max(0, parsed[0]), Math.max(0, parsed[1]), Math.max(0, parsed[2])]
    : fallback;
}

export function parseEnvironmentLightingModel(
  yamlText = lightingModelYaml,
): EnvironmentLightingModelSettings {
  try {
    const root = asRecord(load(yamlText));
    const model = asRecord(root.environment_lighting);
    const horizonFadeStart = finite(model.horizon_fade_start, FALLBACK_LIGHTING_MODEL.horizonFadeStart);
    const horizonFadeEnd = Math.max(
      horizonFadeStart + 0.001,
      finite(model.horizon_fade_end, FALLBACK_LIGHTING_MODEL.horizonFadeEnd),
    );
    return {
      directScale: nonNegative(model.direct_scale, FALLBACK_LIGHTING_MODEL.directScale),
      skyAmbientScale: nonNegative(model.sky_ambient_scale, FALLBACK_LIGHTING_MODEL.skyAmbientScale),
      groundAmbientScale: nonNegative(model.ground_ambient_scale, FALLBACK_LIGHTING_MODEL.groundAmbientScale),
      ambientFloor: nonNegative(model.ambient_floor, FALLBACK_LIGHTING_MODEL.ambientFloor),
      horizonFadeStart,
      horizonFadeEnd,
      extinctionRgb: rgb(model.extinction_rgb, FALLBACK_LIGHTING_MODEL.extinctionRgb),
    };
  } catch (error) {
    console.warn("[environment] failed to parse lighting_model.yaml; using fallback", error);
    return { ...FALLBACK_LIGHTING_MODEL, extinctionRgb: [...FALLBACK_LIGHTING_MODEL.extinctionRgb] };
  }
}

export const ENVIRONMENT_LIGHTING_MODEL = parseEnvironmentLightingModel();

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(0.000001, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Stable optical air-mass approximation for a game-scale sun model. */
export function environmentSunAirMass(sunHeight: number): number {
  const h = Math.max(-0.08, Math.min(1, sunHeight));
  return 1 / Math.max(0.08, h + 0.12);
}

export function environmentSunTransmittance(
  sunDirection: THREE.Vector3,
  model: EnvironmentLightingModelSettings = ENVIRONMENT_LIGHTING_MODEL,
): THREE.Color {
  const opticalDepth = Math.max(0, environmentSunAirMass(sunDirection.y) - 1);
  return new THREE.Color(
    Math.exp(-model.extinctionRgb[0] * opticalDepth),
    Math.exp(-model.extinctionRgb[1] * opticalDepth),
    Math.exp(-model.extinctionRgb[2] * opticalDepth),
  );
}

export function deriveEnvironmentLighting(
  sunDirection: THREE.Vector3,
  settings: EnvironmentSettings,
  colors: EnvironmentColors,
  model: EnvironmentLightingModelSettings = ENVIRONMENT_LIGHTING_MODEL,
): EnvironmentLighting {
  const direction = sunDirection.clone().normalize();
  const transmittance = environmentSunTransmittance(direction, model);
  const aboveHorizon = smoothstep(model.horizonFadeStart, model.horizonFadeEnd, direction.y);
  const luminance = 0.2126 * transmittance.r + 0.7152 * transmittance.g + 0.0722 * transmittance.b;
  const daylight = aboveHorizon * (0.35 + 0.65 * luminance);

  const sunColor = colors.sun.clone()
    .multiply(transmittance)
    .multiplyScalar(settings.sunIntensity * model.directScale * aboveHorizon);
  const skyLight = colors.skyLight.clone()
    .multiplyScalar(settings.skyIntensity * model.skyAmbientScale * (0.55 + daylight * 0.45));
  const groundLight = colors.groundLight.clone()
    .multiplyScalar(settings.groundIntensity * model.groundAmbientScale * (0.45 + daylight * 0.55));

  return {
    sunDirection: direction,
    sunColor,
    skyLight,
    groundLight,
    ambientFloor: model.ambientFloor * (0.4 + daylight * 0.6),
  };
}
