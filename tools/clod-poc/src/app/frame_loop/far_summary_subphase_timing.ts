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

export function resetFarSummarySubphaseCounters(counters: Record<string, number>): void {
  for (const key of FAR_SUMMARY_SUBPHASE_METRICS) counters[key] = 0;
}

export function readFarSummarySubphaseCounters(counters: Record<string, number> | undefined): FarSummarySubphaseSnapshot {
  const snapshot = emptyFarSummarySubphaseSnapshot();
  if (!counters) return snapshot;
  for (const key of FAR_SUMMARY_SUBPHASE_METRICS) {
    const value = counters[key];
    snapshot[key] = Number.isFinite(value) ? value : 0;
  }
  return snapshot;
}

export function timeFarSummarySubphase<T>(
  counters: Record<string, number> | undefined,
  key: FarSummarySubphaseMetric,
  fn: () => T,
): T {
  if (!counters) return fn();
  const startedAt = performance.now();
  try {
    return fn();
  } finally {
    counters[key] = (counters[key] ?? 0) + performance.now() - startedAt;
  }
}
