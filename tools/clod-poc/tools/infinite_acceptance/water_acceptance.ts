export const WATER_ACCEPTANCE_MAX_P95_MS = 0.5;
export const WATER_ACCEPTANCE_MAX_FRAME_MS = 2;
export const WATER_ACCEPTANCE_MIN_ATLAS_LEVELS = 4;
export const WATER_ACCEPTANCE_SHOT_NAMES = ["river-close", "river-aerial", "lake", "shore"] as const;

export type WaterAcceptanceShotName = typeof WATER_ACCEPTANCE_SHOT_NAMES[number];

export interface WaterAcceptanceInput {
  readonly counters: Readonly<Record<string, number>>;
  readonly startupTimings: Readonly<Record<string, number>>;
}

export interface WaterShotSanityInput {
  readonly failures: readonly string[];
}

function finiteValue(values: Readonly<Record<string, number>>, key: string): number {
  const value = values[key];
  return Number.isFinite(value) ? value : Number.NaN;
}

function requireEnabledCounter(
  failures: string[],
  counters: Readonly<Record<string, number>>,
  key: string,
): void {
  const value = finiteValue(counters, key);
  if (value !== 1) failures.push(`${key}=${value} must equal 1`);
}

export function evaluateWaterShotSanity(
  shots: Partial<Readonly<Record<WaterAcceptanceShotName, WaterShotSanityInput>>>,
): string[] {
  const failures: string[] = [];
  for (const name of WATER_ACCEPTANCE_SHOT_NAMES) {
    const result = shots[name];
    if (!result) {
      failures.push(`water ${name} image sanity: capture is missing`);
      continue;
    }
    failures.push(...result.failures.map((failure) => `water ${name} image sanity: ${failure}`));
  }
  return failures;
}

export function evaluateWaterAcceptance(input: WaterAcceptanceInput): string[] {
  const failures: string[] = [];
  const continuityPct = finiteValue(input.startupTimings, "river_continuity_pct");
  const uncapturedErrors = finiteValue(input.counters, "webgpu_uncaptured_errors");
  const clipmapEnabled = finiteValue(input.counters, "water_clipmap_enabled");
  const visibleLevels = finiteValue(input.counters, "water_clipmap_visible_levels");
  const levelCount = finiteValue(input.counters, "water_clipmap_level_count");
  const atlasDrivenLevelCount = finiteValue(input.counters, "water_atlas_driven_level_count");
  const clipmapOuterHalfSpanM = finiteValue(input.counters, "water_clipmap_outer_half_span_m");
  const farClipmapInnerRadiusM = finiteValue(input.counters, "far_clipmap_inner_radius_m");
  const snaps = finiteValue(input.counters, "water_clipmap_snaps");
  const fieldSamples = finiteValue(input.counters, "water_clipmap_field_samples");
  const waterP95Ms = finiteValue(input.counters, "framePerf.p95.waterMs");
  const waterMaxMs = finiteValue(input.counters, "framePerf.max.waterMs");

  if (!(continuityPct >= 95)) failures.push(`river_continuity_pct=${continuityPct} must be >= 95`);
  if (uncapturedErrors !== 0) failures.push(`webgpu_uncaptured_errors=${uncapturedErrors} must equal 0`);
  requireEnabledCounter(failures, input.counters, "water_high_quality_material_active");
  requireEnabledCounter(failures, input.counters, "water_ssr_active");
  requireEnabledCounter(failures, input.counters, "water_refraction_active");
  requireEnabledCounter(failures, input.counters, "water_caustics_active");
  if (clipmapEnabled !== 1) failures.push(`water_clipmap_enabled=${clipmapEnabled} must equal 1`);
  if (!Number.isInteger(levelCount) || levelCount < WATER_ACCEPTANCE_MIN_ATLAS_LEVELS) {
    failures.push(`water_clipmap_level_count=${levelCount} must be an integer >= ${WATER_ACCEPTANCE_MIN_ATLAS_LEVELS}`);
  }
  if (!Number.isInteger(atlasDrivenLevelCount) || atlasDrivenLevelCount !== levelCount) {
    failures.push(`water_atlas_driven_level_count=${atlasDrivenLevelCount} must equal water_clipmap_level_count=${levelCount}`);
  }
  if (!Number.isInteger(visibleLevels) || visibleLevels !== levelCount) {
    failures.push(`water_clipmap_visible_levels=${visibleLevels} must equal water_clipmap_level_count=${levelCount}`);
  }
  if (!(snaps >= levelCount)) {
    failures.push(`water_clipmap_snaps=${snaps} must be >= water_clipmap_level_count=${levelCount}`);
  }
  if (!(farClipmapInnerRadiusM > 0)) {
    failures.push(`far_clipmap_inner_radius_m=${farClipmapInnerRadiusM} must be > 0`);
  }
  if (!(clipmapOuterHalfSpanM > 0)) {
    failures.push(`water_clipmap_outer_half_span_m=${clipmapOuterHalfSpanM} must be > 0`);
  } else if (farClipmapInnerRadiusM > 0 && clipmapOuterHalfSpanM < farClipmapInnerRadiusM) {
    failures.push(
      `water_clipmap_outer_half_span_m=${clipmapOuterHalfSpanM} must cover far_clipmap_inner_radius_m=${farClipmapInnerRadiusM}`,
    );
  }
  if (fieldSamples !== 0) failures.push(`water_clipmap_field_samples=${fieldSamples} must equal 0 on the atlas path`);
  if (!(waterP95Ms <= WATER_ACCEPTANCE_MAX_P95_MS)) {
    failures.push(`framePerf.p95.waterMs=${waterP95Ms} must be <= ${WATER_ACCEPTANCE_MAX_P95_MS}`);
  }
  if (!(waterMaxMs <= WATER_ACCEPTANCE_MAX_FRAME_MS)) {
    failures.push(`framePerf.max.waterMs=${waterMaxMs} must be <= ${WATER_ACCEPTANCE_MAX_FRAME_MS}`);
  }
  if (Number.isFinite(waterP95Ms) && Number.isFinite(waterMaxMs) && waterMaxMs < waterP95Ms) {
    failures.push(`framePerf.max.waterMs=${waterMaxMs} must be >= framePerf.p95.waterMs=${waterP95Ms}`);
  }
  return failures;
}
