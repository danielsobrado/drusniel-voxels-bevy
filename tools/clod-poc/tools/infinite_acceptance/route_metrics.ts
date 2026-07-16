export interface FrameTimeSummary {
  sampleCount: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  p999Ms: number;
  maxMs: number;
  over16_7: number;
  over33_3: number;
  over100: number;
}

export interface NumericEnvelope {
  first: number;
  last: number;
  min: number;
  max: number;
  highWaterGrowth: number;
  floorGrowth: number;
}

export function percentile(values: readonly number[], fraction: number): number {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return Number.NaN;
  return finite[Math.max(0, Math.ceil(finite.length * fraction) - 1)]!;
}

export function summarizeFrameTimes(values: readonly number[]): FrameTimeSummary {
  const finite = values.filter(Number.isFinite);
  return {
    sampleCount: finite.length,
    p50Ms: percentile(finite, 0.5),
    p95Ms: percentile(finite, 0.95),
    p99Ms: percentile(finite, 0.99),
    p999Ms: percentile(finite, 0.999),
    maxMs: finite.length > 0 ? Math.max(...finite) : Number.NaN,
    over16_7: finite.filter((value) => value > 16.7).length,
    over33_3: finite.filter((value) => value > 33.3).length,
    over100: finite.filter((value) => value > 100).length,
  };
}

export function summarizeNumericEnvelope(values: readonly number[]): NumericEnvelope | null {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return null;
  const first = finite[0]!;
  const last = finite.at(-1)!;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  return {
    first,
    last,
    min,
    max,
    highWaterGrowth: Math.max(0, max - first),
    floorGrowth: Math.max(0, last - first),
  };
}
