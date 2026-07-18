export function frameP95Ms(samplesMs: readonly number[]): number {
  if (samplesMs.length === 0) return 0;
  if (samplesMs.some((value) => !Number.isFinite(value) || value < 0)) return Number.NaN;
  const sorted = [...samplesMs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
}
