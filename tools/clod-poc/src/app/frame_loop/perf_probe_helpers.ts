import type { FramePerfMetric, FramePerfMetricStats, FramePerfBucketRank, FramePerfSample } from "./perf_probe_types.js";

export function intParam(searchParams: URLSearchParams, keys: readonly string[], fallback: number): number {
  for (const key of keys) {
    const raw = searchParams.get(key);
    if (raw === null) continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  return fallback;
}

export function emptyMetricStats(): FramePerfMetricStats {
  return { avg: 0, min: 0, max: 0, p50: 0, p95: 0 };
}

export function percentile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] ?? 0;
}

export function statsFor(samples: readonly FramePerfSample[], metric: FramePerfMetric): FramePerfMetricStats {
  if (samples.length === 0) return emptyMetricStats();
  const values = samples.map((s) => s[metric]).sort((a, b) => a - b);
  const total = values.reduce((s, v) => s + v, 0);
  return {
    avg: total / values.length,
    min: values[0] ?? 0,
    max: values[values.length - 1] ?? 0,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
  };
}

export function rankBuckets(metrics: Record<FramePerfMetric, FramePerfMetricStats>, bucketNames: readonly FramePerfMetric[]): FramePerfBucketRank[] {
  return bucketNames.map((n) => ({ name: n, p95: metrics[n].p95, avg: metrics[n].avg })).sort((a, b) => b.p95 - a.p95);
}

export function avgCounter(samples: readonly FramePerfSample[], key: keyof FramePerfSample): number {
  if (samples.length === 0) return 0;
  const total = samples.reduce((s, sample) => { const v = sample[key]; return typeof v === "number" ? s + v : s; }, 0);
  return total / samples.length;
}

export function minPositiveCounter(samples: readonly FramePerfSample[], key: keyof FramePerfSample): number {
  const values = samples.map((s) => s[key]).filter((v): v is number => typeof v === "number" && v > 0).sort((a, b) => a - b);
  return values[0] ?? 0;
}

export function avgGpuPasses(samples: readonly FramePerfSample[]): Record<string, number> {
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const sample of samples) {
    if (!sample.gpuPasses) continue;
    for (const [label, ms] of Object.entries(sample.gpuPasses)) {
      sums[label] = (sums[label] ?? 0) + ms;
      counts[label] = (counts[label] ?? 0) + 1;
    }
  }
  const avg: Record<string, number> = {};
  for (const label of Object.keys(sums)) avg[label] = sums[label] / Math.max(1, counts[label]);
  return avg;
}

export function countTreeGpuStatuses(samples: readonly FramePerfSample[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sample of samples) counts[sample.treeGpuStatus] = (counts[sample.treeGpuStatus] ?? 0) + 1;
  return counts;
}

export function countCustomPropGpuStatuses(samples: readonly FramePerfSample[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sample of samples) counts[sample.customPropGpuStatus] = (counts[sample.customPropGpuStatus] ?? 0) + 1;
  return counts;
}
