import { load } from "js-yaml";
import riverAmbienceConfigText from "../../config/river_ambience.yaml?raw";

export interface CalmWaterRiseRingSettings {
  readonly enabled: boolean;
  readonly strength: number;
  readonly spawnRadiusM: number;
  readonly scanIntervalS: number;
  readonly scanGrid: number;
  readonly cellSpacingM: number;
  readonly cellsPerFrame: number;
  readonly maxEmittersPerScan: number;
  readonly maxRings: number;
  readonly segmentsPerRing: number;
  readonly minimumDepthM: number;
  readonly minimumShoreDistanceM: number;
  readonly maximumFlowStrength: number;
  readonly maximumBedDropM: number;
  readonly lifeMinS: number;
  readonly lifeMaxS: number;
  readonly startRadiusM: number;
  readonly endRadiusM: number;
}

const FALLBACK_SETTINGS: Readonly<CalmWaterRiseRingSettings> = Object.freeze({
  enabled: true,
  strength: 0.55,
  spawnRadiusM: 64,
  scanIntervalS: 0.45,
  scanGrid: 19,
  cellSpacingM: 7,
  cellsPerFrame: 8,
  maxEmittersPerScan: 6,
  maxRings: 48,
  segmentsPerRing: 24,
  minimumDepthM: 0.35,
  minimumShoreDistanceM: 3,
  maximumFlowStrength: 0.35,
  maximumBedDropM: 0.18,
  lifeMinS: 1.2,
  lifeMaxS: 2.2,
  startRadiusM: 0.12,
  endRadiusM: 1.35,
});

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function numberAt(source: Record<string, unknown> | null, key: string, fallback: number): number {
  const value = Number(source?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function integer(value: number, minimum: number, maximum: number, fallback: number): number {
  return Math.floor(clamp(value, minimum, maximum, fallback));
}

export function sanitizeCalmWaterRiseRingSettings(
  source: CalmWaterRiseRingSettings,
): CalmWaterRiseRingSettings {
  const fallback = FALLBACK_SETTINGS;
  const lifeMinS = clamp(source.lifeMinS, 0.3, 8, fallback.lifeMinS);
  const lifeMaxS = Math.max(lifeMinS, clamp(source.lifeMaxS, 0.3, 12, fallback.lifeMaxS));
  const startRadiusM = clamp(source.startRadiusM, 0.01, 2, fallback.startRadiusM);
  const endRadiusM = Math.max(startRadiusM, clamp(source.endRadiusM, 0.02, 8, fallback.endRadiusM));
  return {
    enabled: source.enabled,
    strength: clamp(source.strength, 0, 3, fallback.strength),
    spawnRadiusM: clamp(source.spawnRadiusM, 8, 180, fallback.spawnRadiusM),
    scanIntervalS: clamp(source.scanIntervalS, 0.1, 4, fallback.scanIntervalS),
    scanGrid: integer(source.scanGrid, 5, 33, fallback.scanGrid) | 1,
    cellSpacingM: clamp(source.cellSpacingM, 2, 24, fallback.cellSpacingM),
    cellsPerFrame: integer(source.cellsPerFrame, 1, 32, fallback.cellsPerFrame),
    maxEmittersPerScan: integer(source.maxEmittersPerScan, 1, 24, fallback.maxEmittersPerScan),
    maxRings: integer(source.maxRings, 4, 192, fallback.maxRings),
    segmentsPerRing: integer(source.segmentsPerRing, 8, 64, fallback.segmentsPerRing),
    minimumDepthM: clamp(source.minimumDepthM, 0.05, 12, fallback.minimumDepthM),
    minimumShoreDistanceM: clamp(source.minimumShoreDistanceM, 0, 40, fallback.minimumShoreDistanceM),
    maximumFlowStrength: clamp(source.maximumFlowStrength, 0.01, 4, fallback.maximumFlowStrength),
    maximumBedDropM: clamp(source.maximumBedDropM, 0.01, 4, fallback.maximumBedDropM),
    lifeMinS,
    lifeMaxS,
    startRadiusM,
    endRadiusM,
  };
}

export function parseCalmWaterRiseRingSettings(
  text: string = riverAmbienceConfigText,
): CalmWaterRiseRingSettings {
  const fallback = FALLBACK_SETTINGS;
  try {
    const document = record(load(text));
    const ambience = record(document?.river_ambience);
    const source = record(ambience?.calm_water_rise_rings);
    return sanitizeCalmWaterRiseRingSettings({
      enabled: typeof source?.enabled === "boolean" ? source.enabled : fallback.enabled,
      strength: numberAt(source, "strength", fallback.strength),
      spawnRadiusM: numberAt(source, "spawn_radius_m", fallback.spawnRadiusM),
      scanIntervalS: numberAt(source, "scan_interval_s", fallback.scanIntervalS),
      scanGrid: numberAt(source, "scan_grid", fallback.scanGrid),
      cellSpacingM: numberAt(source, "cell_spacing_m", fallback.cellSpacingM),
      cellsPerFrame: numberAt(source, "cells_per_frame", fallback.cellsPerFrame),
      maxEmittersPerScan: numberAt(source, "max_emitters_per_scan", fallback.maxEmittersPerScan),
      maxRings: numberAt(source, "max_rings", fallback.maxRings),
      segmentsPerRing: numberAt(source, "segments_per_ring", fallback.segmentsPerRing),
      minimumDepthM: numberAt(source, "minimum_depth_m", fallback.minimumDepthM),
      minimumShoreDistanceM: numberAt(source, "minimum_shore_distance_m", fallback.minimumShoreDistanceM),
      maximumFlowStrength: numberAt(source, "maximum_flow_strength", fallback.maximumFlowStrength),
      maximumBedDropM: numberAt(source, "maximum_bed_drop_m", fallback.maximumBedDropM),
      lifeMinS: numberAt(source, "life_min_s", fallback.lifeMinS),
      lifeMaxS: numberAt(source, "life_max_s", fallback.lifeMaxS),
      startRadiusM: numberAt(source, "start_radius_m", fallback.startRadiusM),
      endRadiusM: numberAt(source, "end_radius_m", fallback.endRadiusM),
    });
  } catch (error) {
    console.warn("[water] failed to parse calm-water rise-ring config; using fallback", error);
    return { ...fallback };
  }
}

function runtimeParams(): URLSearchParams | null {
  return typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
}

function performancePreset(params: URLSearchParams | null): boolean {
  const explicit = params?.get("waterPerf") ?? params?.get("waterPerformance") ?? params?.get("waterLow");
  if (explicit !== null && explicit !== undefined) return explicit !== "0" && explicit !== "false";
  const quality = params?.get("quality") ?? params?.get("qualityPreset") ?? params?.get("preset");
  return quality === "perf" || quality === "potato";
}

function booleanOverride(params: URLSearchParams | null, key: string, fallback: boolean): boolean {
  const value = params?.get(key);
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return fallback;
}

function numberOverride(params: URLSearchParams | null, key: string, fallback: number): number {
  const value = Number(params?.get(key));
  return Number.isFinite(value) ? value : fallback;
}

export const DEFAULT_CALM_WATER_RISE_RING_SETTINGS: Readonly<CalmWaterRiseRingSettings> = Object.freeze(
  parseCalmWaterRiseRingSettings(),
);

export function readCalmWaterRiseRingSettings(): CalmWaterRiseRingSettings {
  const params = runtimeParams();
  const defaults = DEFAULT_CALM_WATER_RISE_RING_SETTINGS;
  return sanitizeCalmWaterRiseRingSettings({
    ...defaults,
    enabled: booleanOverride(
      params,
      "calmWaterRiseRings",
      performancePreset(params) ? false : defaults.enabled,
    ),
    strength: numberOverride(params, "calmWaterRiseRingStrength", defaults.strength),
    spawnRadiusM: numberOverride(params, "calmWaterRiseRingRadius", defaults.spawnRadiusM),
    maxRings: numberOverride(params, "calmWaterRiseRingMax", defaults.maxRings),
  });
}
