import { cloneWaterConfig } from "./water_config_clone.js";
import type { WaterConfig } from "./water_config_types.js";

const PERF_WATER_CELL_SIZES = [3, 6, 12, 24];
const BALANCED_WATER_CELL_SIZES = [2, 4, 8, 16, 32];

export type WaterQualityTier = "low" | "high";

function flagParam(searchParams: URLSearchParams, keys: readonly string[]): boolean | null {
  for (const key of keys) {
    const raw = searchParams.get(key);
    if (raw === null) continue;
    const value = raw.trim().toLowerCase();
    if (value === "1" || value === "true" || value === "on" || value === "yes") return true;
    if (value === "0" || value === "false" || value === "off" || value === "no") return false;
  }
  return null;
}

function finiteNumberParam(searchParams: URLSearchParams, keys: readonly string[]): number | null {
  for (const key of keys) {
    const raw = searchParams.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function qualityParam(searchParams: URLSearchParams): string | null {
  return searchParams.get("quality") ?? searchParams.get("qualityPreset") ?? searchParams.get("preset");
}

function shouldUsePerfWater(searchParams: URLSearchParams): boolean {
  const explicit = flagParam(searchParams, ["waterPerf", "waterPerformance", "waterLow"]);
  if (explicit !== null) return explicit;
  return qualityParam(searchParams) === "perf" || qualityParam(searchParams) === "potato";
}

function shouldUseBalancedWater(searchParams: URLSearchParams): boolean {
  return qualityParam(searchParams) === "balanced";
}

export function resolveWaterQualityTier(searchParams: URLSearchParams): WaterQualityTier {
  const explicit = searchParams.get("waterQuality")?.trim().toLowerCase();
  if (explicit === "low" || explicit === "high") return explicit;

  const legacyHighQuality = flagParam(searchParams, ["waterHq"]);
  if (legacyHighQuality !== null) return legacyHighQuality ? "high" : "low";

  return shouldUsePerfWater(searchParams) ? "low" : "high";
}

export function applyWaterQueryOverrides(config: WaterConfig, searchParams: URLSearchParams): WaterConfig {
  const next = cloneWaterConfig(config);
  const waterQuality = resolveWaterQualityTier(searchParams);
  const enabled = flagParam(searchParams, ["water", "waterEnabled"]);
  if (enabled !== null) next.enabled = enabled;

  if (shouldUsePerfWater(searchParams)) {
    next.cellsPerLevel = Math.min(next.cellsPerLevel, 64);
    next.cellSizes = PERF_WATER_CELL_SIZES;
    next.visual.refraction.enabled = false;
    next.visual.refraction.strength = 0;
    next.visual.reflection.mode = "fake";
    next.visual.reflection.ssrEnabled = false;
    next.visual.rippleAmp *= 0.55;
    next.visual.foam.riverStrength *= 0.65;
    next.visual.foam.shoreStrength *= 0.65;
    next.caustics.enabled = false;
    next.hydrology.accumulation.particles = Math.min(next.hydrology.accumulation.particles, 120_000);
    next.hydrology.fill.iterations = Math.min(next.hydrology.fill.iterations, 420);
    next.hydrology.talus.iterations = Math.min(next.hydrology.talus.iterations, 4);
  } else if (shouldUseBalancedWater(searchParams)) {
    next.cellsPerLevel = Math.min(next.cellsPerLevel, 96);
    next.cellSizes = BALANCED_WATER_CELL_SIZES;
    next.visual.refraction.strength *= 0.7;
    next.visual.reflection.ssrEnabled = false;
    next.hydrology.accumulation.particles = Math.min(next.hydrology.accumulation.particles, 220_000);
  }

  const waterCells = finiteNumberParam(searchParams, ["waterCells", "waterCellsPerLevel"]);
  if (waterCells !== null) next.cellsPerLevel = Math.max(16, Math.min(128, Math.floor(waterCells)));

  const refraction = flagParam(searchParams, ["waterRefraction", "refraction"]);
  if (refraction !== null) {
    next.visual.refraction.enabled = refraction;
    if (!refraction) next.visual.refraction.strength = 0;
  }

  const waterCaustics = flagParam(searchParams, ["waterCaustics", "caustics"]);
  next.caustics.enabled = waterCaustics ?? waterQuality === "high";

  const glacialMurkiness = flagParam(searchParams, ["waterGlacialMurkiness", "glacialWater", "waterGlacial"]);
  if (glacialMurkiness !== null) next.visual.glacialMurkiness.enabled = glacialMurkiness;

  const reflectionTiers = flagParam(searchParams, [
    "waterReflectionTiers",
    "waterMidReflection",
    "waterReflectionFallback",
  ]);
  if (reflectionTiers !== null) next.visual.reflection.clipmapTiers.enabled = reflectionTiers;

  const hydroUnified = flagParam(searchParams, ["hydroUnified", "hydroUnifiedStartup"]);
  if (hydroUnified !== null) next.hydrology.infinite.unifiedStartup = hydroUnified;

  return next;
}
