import type { WaterFoamRuntimeDiagnostics } from "../src/water/water_foam_diagnostics.js";
import {
  WATER_FOAM_MAX_COVERAGE,
  WATER_FOAM_MODEL_REVISION,
  WATER_FOAM_PATTERN_END,
  WATER_FOAM_PATTERN_START,
  WATER_FOAM_RIVER_SHORE_ATTENUATION,
  WATER_FOAM_SHORE_DISTANCE_WEIGHT,
} from "../src/water/water_foam_model.js";
import type { WaterFoamAcceptanceQuality } from "./water-foam-acceptance-profile.js";

export interface WaterFoamWebGlRuntimeContractResult {
  readonly passed: boolean;
  readonly failures: readonly string[];
}

export function evaluateWaterFoamWebGlRuntimeContract(
  expectedQuality: WaterFoamAcceptanceQuality,
  diagnostics: WaterFoamRuntimeDiagnostics,
): WaterFoamWebGlRuntimeContractResult {
  const failures: string[] = [];
  requireEqual(failures, "model revision", diagnostics.modelRevision, WATER_FOAM_MODEL_REVISION);
  requireEqual(failures, "quality tier", diagnostics.qualityTier, expectedQuality);
  requireEqual(failures, "max coverage", diagnostics.maxCoverage, WATER_FOAM_MAX_COVERAGE);
  requireEqual(failures, "pattern start", diagnostics.patternStart, WATER_FOAM_PATTERN_START);
  requireEqual(failures, "pattern end", diagnostics.patternEnd, WATER_FOAM_PATTERN_END);
  requireEqual(failures, "shore-distance weight", diagnostics.shoreDistanceWeight, WATER_FOAM_SHORE_DISTANCE_WEIGHT);
  requireEqual(failures, "river-shore attenuation", diagnostics.riverShoreAttenuation, WATER_FOAM_RIVER_SHORE_ATTENUATION);
  requireEqual(failures, "rapid eligibility", diagnostics.rapidEligibility, "speed-times-drop-times-river");
  requireEqual(failures, "CPU field samples", diagnostics.cpuFieldSamples, 0);
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
