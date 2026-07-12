/** Per-frame attribution for the composite `farSummaryMs` bracket. The bracket
 *  wraps several independent subsystems (far-summary tile cache, NAADF
 *  streaming, infinite far shell, shadow proxy, biome streaming, sun-light
 *  cache, stats DOM); treat the buckets as separate symptoms, never sum them.
 *  Timings accumulate in a module store and are drained once per frame by the
 *  render phase when it records a perf sample. */

export const FRAME_PERF_FAR_SUMMARY_BUCKETS = [
  "farSumTilesMs",
  "farSumNaadfMs",
  "farSumShellMs",
  "farSumClipmapMs",
  "farSumShellMoveMs",
  "farSumShadowProxyMs",
  "farSumBiomeStreamMs",
  "farSumSunLightMs",
  "farSumStatsDomMs",
] as const;

export type FarSummarySubphaseBucket = typeof FRAME_PERF_FAR_SUMMARY_BUCKETS[number];
export type FarSummarySubphaseTimings = Record<FarSummarySubphaseBucket, number>;

function zeroTimings(): FarSummarySubphaseTimings {
  return {
    farSumTilesMs: 0,
    farSumNaadfMs: 0,
    farSumShellMs: 0,
    farSumClipmapMs: 0,
    farSumShellMoveMs: 0,
    farSumShadowProxyMs: 0,
    farSumBiomeStreamMs: 0,
    farSumSunLightMs: 0,
    farSumStatsDomMs: 0,
  };
}

const store: FarSummarySubphaseTimings = zeroTimings();

export function timeFarSummarySubphase<T>(bucket: FarSummarySubphaseBucket, fn: () => T): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    store[bucket] += performance.now() - start;
  }
}

/** Returns the accumulated timings for this frame and resets the store. */
export function takeFarSummarySubphaseTimings(): FarSummarySubphaseTimings {
  const out: FarSummarySubphaseTimings = { ...store };
  for (const bucket of FRAME_PERF_FAR_SUMMARY_BUCKETS) store[bucket] = 0;
  return out;
}
