export const WATER_FOAM_MODEL_REVISION = 3;
export const WATER_FOAM_MAX_COVERAGE = 0.52;
export const WATER_FOAM_PATTERN_START = 0.52;
export const WATER_FOAM_PATTERN_END = 0.88;
export const WATER_FOAM_BASE_WEIGHT = 0.68;
export const WATER_FOAM_DETAIL_WEIGHT = 0.32;
export const WATER_FOAM_SHORE_DISTANCE_WEIGHT = 0.35;
export const WATER_FOAM_RIVER_SHORE_ATTENUATION = 0.28;
export const WATER_FOAM_BANK_DROP_BASE = 0.08;
export const WATER_FOAM_BANK_DROP_GAIN = 0.72;
export const WATER_FOAM_SHADE_COVERAGE_FLOOR = 0.55;

export interface WaterFoamModelInput {
  readonly shoreContact: number;
  readonly rapidSpeed: number;
  readonly rapidDrop: number;
  readonly riverWeight: number;
  readonly pattern: number;
  readonly wetFade: number;
  readonly sunVisibility: number;
  readonly shoreStrength: number;
  readonly riverStrength: number;
  readonly bankStrength: number;
  readonly rapidStrength: number;
}

export interface WaterFoamModelResult {
  readonly coverage: number;
  readonly shoreSource: number;
  readonly rapidSource: number;
  readonly bankSource: number;
  readonly shadeCoverage: number;
}

export function rapidFoamEligibility(
  rapidSpeed: number,
  rapidDrop: number,
  riverWeight: number,
): number {
  return clamp01(rapidSpeed) * clamp01(rapidDrop) * clamp01(riverWeight);
}

export function evaluateWaterFoam(input: WaterFoamModelInput): WaterFoamModelResult {
  const shoreContact = clamp01(input.shoreContact);
  const riverWeight = clamp01(input.riverWeight);
  const rapidDrop = clamp01(input.rapidDrop);
  const pattern = clamp01(input.pattern);
  const wetFade = clamp01(input.wetFade);
  const sunVisibility = clamp01(input.sunVisibility);
  const shadeCoverage = WATER_FOAM_SHADE_COVERAGE_FLOOR
    + (1 - WATER_FOAM_SHADE_COVERAGE_FLOOR) * sunVisibility;
  const shoreBodyWeight = 1 + (WATER_FOAM_RIVER_SHORE_ATTENUATION - 1) * riverWeight;

  const shoreSource = shoreContact * Math.max(0, input.shoreStrength) * shoreBodyWeight;
  const rapidSource = rapidFoamEligibility(input.rapidSpeed, rapidDrop, riverWeight)
    * Math.max(0, input.rapidStrength);
  const bankSource = shoreContact
    * riverWeight
    * Math.max(0, input.bankStrength)
    * (WATER_FOAM_BANK_DROP_BASE + rapidDrop * WATER_FOAM_BANK_DROP_GAIN);
  const source = shoreSource + (rapidSource + bankSource) * Math.max(0, input.riverStrength);

  return {
    coverage: Math.min(
      WATER_FOAM_MAX_COVERAGE,
      Math.max(0, source * pattern * wetFade * shadeCoverage),
    ),
    shoreSource,
    rapidSource,
    bankSource,
    shadeCoverage,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
