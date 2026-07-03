export const FAR_SUMMARY_SUBPHASE_METRICS = [
  "farSumTilesMs",
  "farSumNaadfMs",
  "farSumShellMs",
  "farSumShadowProxyMs",
  "farSumBiomeStreamMs",
  "farSumSunLightMs",
  "farSumStatsDomMs",
] as const;

export type FarSummarySubphaseMetric = typeof FAR_SUMMARY_SUBPHASE_METRICS[number];

export type FarSummarySubphaseSnapshot = Record<FarSummarySubphaseMetric, number>;

export function emptyFarSummarySubphaseSnapshot(): FarSummarySubphaseSnapshot {
  return Object.fromEntries(FAR_SUMMARY_SUBPHASE_METRICS.map((key) => [key, 0])) as FarSummarySubphaseSnapshot;
}

// Authoritative per-frame store. Long-view stats counters only exist in
// long-view scenes, so timings must not depend on them or every other scene
// records zeros.
const subphaseStore: FarSummarySubphaseSnapshot = emptyFarSummarySubphaseSnapshot();

export function resetFarSummarySubphaseCounters(counters?: Record<string, number>): void {
  for (const key of FAR_SUMMARY_SUBPHASE_METRICS) {
    subphaseStore[key] = 0;
    if (counters) counters[key] = 0;
  }
}

export function readFarSummarySubphaseCounters(): FarSummarySubphaseSnapshot {
  return { ...subphaseStore };
}

export function timeFarSummarySubphase<T>(
  counters: Record<string, number> | undefined,
  key: FarSummarySubphaseMetric,
  fn: () => T,
): T {
  const startedAt = performance.now();
  try {
    return fn();
  } finally {
    const elapsed = performance.now() - startedAt;
    subphaseStore[key] += elapsed;
    if (counters) counters[key] = (counters[key] ?? 0) + elapsed;
  }
}
