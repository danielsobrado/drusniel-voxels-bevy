import {
  WATER_FOAM_MAX_COVERAGE,
  WATER_FOAM_MODEL_REVISION,
  WATER_FOAM_PATTERN_END,
  WATER_FOAM_PATTERN_START,
  WATER_FOAM_RIVER_SHORE_ATTENUATION,
  WATER_FOAM_SHADE_COVERAGE_FLOOR,
  WATER_FOAM_SHORE_DISTANCE_WEIGHT,
} from "../src/water/water_foam_model.js";
import type { WaterFoamRuntimeDiagnostics } from "../src/water/water_foam_diagnostics.js";
import type { WaterFoamAcceptanceQuality } from "./water-foam-acceptance-profile.js";

export interface WaterFoamRuntimeContractResult {
  readonly passed: boolean;
  readonly failures: readonly string[];
}

export function evaluateWaterFoamRuntimeContract(
  expectedQuality: WaterFoamAcceptanceQuality,
  diagnostics: WaterFoamRuntimeDiagnostics,
): WaterFoamRuntimeContractResult {
  const failures: string[] = [];
  requireEqual(failures, "model revision", diagnostics.modelRevision, WATER_FOAM_MODEL_REVISION);
  requireEqual(failures, "model name", diagnostics.modelName, "coherent-fbm-flow-sun-v3");
  requireEqual(failures, "quality tier", diagnostics.qualityTier, expectedQuality);
  requireEqual(failures, "max coverage", diagnostics.maxCoverage, WATER_FOAM_MAX_COVERAGE);
  requireEqual(failures, "pattern start", diagnostics.patternStart, WATER_FOAM_PATTERN_START);
  requireEqual(failures, "pattern end", diagnostics.patternEnd, WATER_FOAM_PATTERN_END);
  requireEqual(failures, "shore-distance weight", diagnostics.shoreDistanceWeight, WATER_FOAM_SHORE_DISTANCE_WEIGHT);
  requireEqual(failures, "river-shore attenuation", diagnostics.riverShoreAttenuation, WATER_FOAM_RIVER_SHORE_ATTENUATION);
  requireEqual(failures, "shade coverage floor", diagnostics.shadeCoverageFloor, WATER_FOAM_SHADE_COVERAGE_FLOOR);
  requireEqual(failures, "rapid eligibility", diagnostics.rapidEligibility, "speed-times-drop-times-river");
  requireEqual(failures, "CPU field samples", diagnostics.cpuFieldSamples, 0);
  requireEqual(failures, "sun atlas valid", diagnostics.sunAtlas.valid, 1);
  requireMin(failures, "sun atlas version", diagnostics.sunAtlas.version, 1);
  requireMin(failures, "sun atlas width", diagnostics.sunAtlas.width, 2);
  requireMin(failures, "sun atlas height", diagnostics.sunAtlas.height, 2);
  requireMin(failures, "sun atlas world size", diagnostics.sunAtlas.worldSize, 1);
  return { passed: failures.length === 0, failures };
}

function requireEqual(
  failures: string[],
  label: string,
  actual: string | number,
  expected: string | number,
): void {
  if (actual !== expected) failures.push(`${label} ${String(actual)} did not equal ${String(expected)}`);
}

function requireMin(failures: string[], label: string, actual: number, min: number): void {
  if (!Number.isFinite(actual) || actual < min) failures.push(`${label} ${String(actual)} is below ${String(min)}`);
}
