export const WATER_ACCEPTANCE_MAX_P95_MS = 0.5;
export const WATER_ACCEPTANCE_MAX_FRAME_MS = 2;

export interface WaterAcceptanceInput {
  readonly counters: Readonly<Record<string, number>>;
  readonly startupTimings: Readonly<Record<string, number>>;
}

function finiteValue(values: Readonly<Record<string, number>>, key: string): number {
  const value = values[key];
  return Number.isFinite(value) ? value : Number.NaN;
}

export function evaluateWaterAcceptance(input: WaterAcceptanceInput): string[] {
  const failures: string[] = [];
  const continuityPct = finiteValue(input.startupTimings, "river_continuity_pct");
  const uncapturedErrors = finiteValue(input.counters, "webgpu_uncaptured_errors");
  const clipmapEnabled = finiteValue(input.counters, "water_clipmap_enabled");
  const visibleLevels = finiteValue(input.counters, "water_clipmap_visible_levels");
  const levelCount = finiteValue(input.counters, "water_clipmap_level_count");
  const fieldSamples = finiteValue(input.counters, "water_clipmap_field_samples");
  const waterP95Ms = finiteValue(input.counters, "framePerf.p95.waterMs");
  const waterMaxMs = finiteValue(input.counters, "framePerf.max.waterMs");

  if (!(continuityPct >= 95)) failures.push(`river_continuity_pct=${continuityPct} must be >= 95`);
  if (uncapturedErrors !== 0) failures.push(`webgpu_uncaptured_errors=${uncapturedErrors} must equal 0`);
  if (clipmapEnabled !== 1) failures.push(`water_clipmap_enabled=${clipmapEnabled} must equal 1`);
  if (!(visibleLevels > 0)) failures.push(`water_clipmap_visible_levels=${visibleLevels} must be > 0`);
  if (!(levelCount > 0)) failures.push(`water_clipmap_level_count=${levelCount} must be > 0`);
  if (fieldSamples !== 0) failures.push(`water_clipmap_field_samples=${fieldSamples} must equal 0 on the atlas path`);
  if (!(waterP95Ms <= WATER_ACCEPTANCE_MAX_P95_MS)) {
    failures.push(`framePerf.p95.waterMs=${waterP95Ms} must be <= ${WATER_ACCEPTANCE_MAX_P95_MS}`);
  }
  if (!(waterMaxMs <= WATER_ACCEPTANCE_MAX_FRAME_MS)) {
    failures.push(`framePerf.max.waterMs=${waterMaxMs} must be <= ${WATER_ACCEPTANCE_MAX_FRAME_MS}`);
  }
  return failures;
}
