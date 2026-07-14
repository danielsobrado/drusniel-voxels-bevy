import { load } from "js-yaml";
import atmosphereYaml from "../environment/config/postfx_atmosphere.yaml?raw";

export type PostFxColor = [number, number, number];
export type PostFxFroxelDebugMode = "off" | "density" | "transmittance" | "scatter";

export interface PostFxHillaireSettings {
  enabled: boolean;
  strength: number;
  rayleighColor: PostFxColor;
  mieColor: PostFxColor;
  rayleighScaleHeightMeters: number;
  mieScaleHeightMeters: number;
  rayleighExtinction: number;
  mieExtinction: number;
  mieG: number;
  maxDistanceMeters: number;
}

export interface PostFxFroxelSettings {
  enabled: boolean;
  strength: number;
  maxDistanceMeters: number;
  nearMeters: number;
  steps: number;
  groundReferenceHeightMeters: number;
  groundFogDensity: number;
  altitudeFogDensity: number;
  groundFalloffMeters: number;
  altitudeFalloffMeters: number;
  sunDensityBoost: number;
  ambientDensityFloor: number;
  sunShaftsStrength: number;
  noiseStrength: number;
}

export interface PostFxAtmosphereSettings {
  hillaire: PostFxHillaireSettings;
  froxels: PostFxFroxelSettings;
}

const FALLBACK_ATMOSPHERE: PostFxAtmosphereSettings = {
  hillaire: {
    enabled: true,
    strength: 0.30,
    rayleighColor: [0.48, 0.66, 1.0],
    mieColor: [1.0, 0.86, 0.68],
    rayleighScaleHeightMeters: 8200,
    mieScaleHeightMeters: 1200,
    rayleighExtinction: 0.00135,
    mieExtinction: 0.0026,
    mieG: 0.76,
    maxDistanceMeters: 12000,
  },
  froxels: {
    enabled: true,
    strength: 0.26,
    maxDistanceMeters: 480,
    nearMeters: 2,
    steps: 16,
    groundReferenceHeightMeters: 0,
    groundFogDensity: 0.0085,
    altitudeFogDensity: 0.0012,
    groundFalloffMeters: 20,
    altitudeFalloffMeters: 140,
    sunDensityBoost: 1.8,
    ambientDensityFloor: 0.10,
    sunShaftsStrength: 0.82,
    noiseStrength: 0.42,
  },
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

function colorValue(value: unknown, fallback: PostFxColor): PostFxColor {
  if (!Array.isArray(value) || value.length !== 3) return fallback;
  const parsed = value.map(Number);
  return parsed.every(Number.isFinite) ? [parsed[0], parsed[1], parsed[2]] : fallback;
}

export function exponentialFroxelSliceDistance(nearMeters: number, farMeters: number, slice01: number): number {
  const near = Math.max(0.0001, nearMeters);
  const far = Math.max(near, farMeters);
  return near * Math.pow(far / near, clamp(slice01, 0, 1));
}

export interface FroxelSliceMarchSegment {
  active: boolean;
  startMeters: number;
  endMeters: number;
  sampleMeters: number;
  lengthMeters: number;
}

export function froxelSliceMarchSegment(
  nearMeters: number,
  farMeters: number,
  step: number,
  steps: number,
  rayDistanceMeters: number,
  jitter01 = 0.5,
): FroxelSliceMarchSegment {
  const safeSteps = Math.max(1, Math.round(steps));
  const safeStep = Math.min(safeSteps - 1, Math.max(0, Math.floor(step)));
  const startMeters = exponentialFroxelSliceDistance(nearMeters, farMeters, safeStep / safeSteps);
  const sliceEndMeters = exponentialFroxelSliceDistance(nearMeters, farMeters, (safeStep + 1) / safeSteps);
  if (!Number.isFinite(rayDistanceMeters) || rayDistanceMeters <= startMeters) {
    return { active: false, startMeters, endMeters: startMeters, sampleMeters: startMeters, lengthMeters: 0 };
  }
  const endMeters = Math.min(sliceEndMeters, rayDistanceMeters);
  const lengthMeters = Math.max(0, endMeters - startMeters);
  const sliceJitter = clamp(jitter01, 0, 1) * 0.8 + 0.1;
  return {
    active: lengthMeters > 0,
    startMeters,
    endMeters,
    sampleMeters: startMeters + lengthMeters * sliceJitter,
    lengthMeters,
  };
}

export function henyeyGreenstein(cosTheta: number, g: number): number {
  const clampedG = clamp(g, -0.95, 0.95);
  const gg = clampedG * clampedG;
  const denom = Math.pow(Math.max(0.0001, 1 + gg - 2 * clampedG * clamp(cosTheta, -1, 1)), 1.5);
  return (1 - gg) / (4 * Math.PI * denom);
}

export function parsePostFxFroxelDebugMode(value: unknown): PostFxFroxelDebugMode {
  if (typeof value !== "string") return "off";
  const normalized = value.trim().toLowerCase().replace(/[-_\s]/g, "");
  if (normalized === "density" || normalized === "fogdensity" || normalized === "opticaldepth") return "density";
  if (normalized === "transmittance" || normalized === "transmission") return "transmittance";
  if (normalized === "scatter" || normalized === "scattering" || normalized === "inscatter") return "scatter";
  return "off";
}

function hillaireFromRecord(value: unknown): PostFxHillaireSettings {
  const fallback = FALLBACK_ATMOSPHERE.hillaire;
  const record = isRecord(value) ? value : {};
  return {
    enabled: booleanValue(record.enabled, fallback.enabled),
    strength: clamp(finiteNumber(record.strength, fallback.strength), 0, 2),
    rayleighColor: colorValue(record.rayleigh_color, fallback.rayleighColor),
    mieColor: colorValue(record.mie_color, fallback.mieColor),
    rayleighScaleHeightMeters: positiveNumber(record.rayleigh_scale_height_m, fallback.rayleighScaleHeightMeters),
    mieScaleHeightMeters: positiveNumber(record.mie_scale_height_m, fallback.mieScaleHeightMeters),
    rayleighExtinction: nonNegativeNumber(record.rayleigh_extinction, fallback.rayleighExtinction),
    mieExtinction: nonNegativeNumber(record.mie_extinction, fallback.mieExtinction),
    mieG: clamp(finiteNumber(record.mie_g, fallback.mieG), -0.95, 0.95),
    maxDistanceMeters: positiveNumber(record.max_distance_m, fallback.maxDistanceMeters),
  };
}

function froxelsFromRecord(value: unknown): PostFxFroxelSettings {
  const fallback = FALLBACK_ATMOSPHERE.froxels;
  const record = isRecord(value) ? value : {};
  return {
    enabled: booleanValue(record.enabled, fallback.enabled),
    strength: clamp(finiteNumber(record.strength, fallback.strength), 0, 2),
    maxDistanceMeters: positiveNumber(record.max_distance_m, fallback.maxDistanceMeters),
    nearMeters: positiveNumber(record.near_m, fallback.nearMeters),
    steps: integerValue(record.steps, fallback.steps, 4, 48),
    groundReferenceHeightMeters: finiteNumber(record.ground_reference_m, fallback.groundReferenceHeightMeters),
    groundFogDensity: nonNegativeNumber(record.ground_fog_density, fallback.groundFogDensity),
    altitudeFogDensity: nonNegativeNumber(record.altitude_fog_density, fallback.altitudeFogDensity),
    groundFalloffMeters: positiveNumber(record.ground_falloff_m, fallback.groundFalloffMeters),
    altitudeFalloffMeters: positiveNumber(record.altitude_falloff_m, fallback.altitudeFalloffMeters),
    sunDensityBoost: clamp(finiteNumber(record.sun_density_boost, fallback.sunDensityBoost), 0, 4),
    ambientDensityFloor: clamp(finiteNumber(record.ambient_density_floor, fallback.ambientDensityFloor), 0, 1),
    sunShaftsStrength: clamp(finiteNumber(record.sun_shafts_strength, fallback.sunShaftsStrength), 0, 2),
    noiseStrength: clamp(finiteNumber(record.noise_strength, fallback.noiseStrength), 0, 1),
  };
}

export function parsePostFxAtmosphereSettings(yamlText = atmosphereYaml): PostFxAtmosphereSettings {
  try {
    const raw = load(yamlText);
    if (!isRecord(raw)) return FALLBACK_ATMOSPHERE;
    const root = isRecord(raw.postfx_atmosphere) ? raw.postfx_atmosphere : raw;
    return {
      hillaire: hillaireFromRecord(root.hillaire),
      froxels: froxelsFromRecord(root.froxels),
    };
  } catch (error) {
    console.warn("[webgpu-post] failed to parse postfx_atmosphere.yaml; using fallback", error);
    return FALLBACK_ATMOSPHERE;
  }
}

export const DEFAULT_POSTFX_ATMOSPHERE = parsePostFxAtmosphereSettings();
