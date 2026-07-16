import { summarizeNumericEnvelope, type NumericEnvelope } from "./infinite_acceptance/route_metrics.js";

export interface SoakMinuteSample {
  minute: number;
  usedJsHeapBytes: number | null;
  postGcHeapFloorBytes: number | null;
  estimatedVramBytes: number;
  frameMsP95: number;
  queuesDrained: boolean;
  counters: Record<string, number>;
}

export interface SoakThresholds {
  warmupMinutes: number;
  maxHeapHighWaterGrowthBytes: number;
  maxHeapFloorGrowthBytes: number;
  maxVramHighWaterGrowthBytes: number;
  maxResourceGrowth: number;
  maxLateFrameP95Ratio: number;
  maxBackgroundRecoveryMs: number;
}

export interface SoakEvaluation {
  passed: boolean;
  failures: string[];
  heap: { envelope: NumericEnvelope | null; highWaterGrowth: number; floorGrowth: number };
  vram: NumericEnvelope | null;
  maxResourceGrowth: number;
  lateFrameP95Ratio: number;
}

function resourceKeys(samples: readonly SoakMinuteSample[]): string[] {
  const keys = new Set<string>();
  for (const sample of samples) {
    for (const key of Object.keys(sample.counters)) {
      if (/(resident|cached|cache_size|ready_pages|geometries|textures|programs|buffers|bind_groups)/.test(key)) keys.add(key);
    }
  }
  return [...keys].sort();
}

function growth(values: readonly number[]): number {
  const envelope = summarizeNumericEnvelope(values);
  return envelope?.highWaterGrowth ?? 0;
}

export function evaluateSoak(samples: readonly SoakMinuteSample[], thresholds: SoakThresholds): SoakEvaluation {
  const steady = samples.filter((sample) => sample.minute >= thresholds.warmupMinutes);
  const heapEnvelope = summarizeNumericEnvelope(steady.flatMap((sample) => sample.usedJsHeapBytes === null ? [] : [sample.usedJsHeapBytes]));
  const postGcEnvelope = summarizeNumericEnvelope(steady.flatMap((sample) => sample.postGcHeapFloorBytes === null ? [] : [sample.postGcHeapFloorBytes]));
  const heapHighWaterGrowth = heapEnvelope?.highWaterGrowth ?? 0;
  const heapFloorGrowth = postGcEnvelope?.floorGrowth ?? 0;
  const vramEnvelope = summarizeNumericEnvelope(steady.map((sample) => sample.estimatedVramBytes));
  let maxResourceGrowth = 0;
  for (const key of resourceKeys(steady)) {
    maxResourceGrowth = Math.max(maxResourceGrowth, growth(steady.map((sample) => sample.counters[key] ?? 0)));
  }

  const early = samples.find((sample) => sample.minute >= Math.min(5, samples.at(-1)?.minute ?? 0)) ?? samples[0];
  const late = samples.find((sample) => sample.minute >= 50) ?? samples.at(-1);
  const lateFrameP95Ratio = early && late && early.frameMsP95 > 0 ? late.frameMsP95 / early.frameMsP95 : Number.NaN;
  const failures: string[] = [];
  // Fail closed: a soak shorter than the warmup window or one without post-GC floor
  // evidence must not report a vacuous leak-free pass.
  if (steady.length === 0) {
    failures.push(`no steady-state samples at or after warmupMinutes=${thresholds.warmupMinutes}; run is too short to evaluate`);
  } else if (postGcEnvelope === null) {
    failures.push("post-GC heap floor evidence unavailable; expose window.gc (Chromium --js-flags=--expose-gc) so floor growth is measurable");
  }
  if (heapHighWaterGrowth > thresholds.maxHeapHighWaterGrowthBytes) {
    failures.push(`JS heap high-water growth ${heapHighWaterGrowth.toFixed(0)} B > ${thresholds.maxHeapHighWaterGrowthBytes} B`);
  }
  if (heapFloorGrowth > thresholds.maxHeapFloorGrowthBytes) {
    failures.push(`post-GC heap floor growth ${heapFloorGrowth.toFixed(0)} B > ${thresholds.maxHeapFloorGrowthBytes} B`);
  }
  if ((vramEnvelope?.highWaterGrowth ?? 0) > thresholds.maxVramHighWaterGrowthBytes) {
    failures.push(`estimated VRAM high-water growth ${vramEnvelope!.highWaterGrowth.toFixed(0)} B > ${thresholds.maxVramHighWaterGrowthBytes} B`);
  }
  if (maxResourceGrowth > thresholds.maxResourceGrowth) {
    failures.push(`resource high-water growth ${maxResourceGrowth.toFixed(0)} > ${thresholds.maxResourceGrowth}`);
  }
  for (const sample of steady) {
    if (!sample.queuesDrained) failures.push(`streaming queues were not drained at minute ${sample.minute}`);
  }
  if (Number.isFinite(lateFrameP95Ratio) && lateFrameP95Ratio > thresholds.maxLateFrameP95Ratio) {
    failures.push(`late/early frame p95 ratio ${lateFrameP95Ratio.toFixed(3)} > ${thresholds.maxLateFrameP95Ratio}`);
  }
  return {
    passed: failures.length === 0,
    failures,
    heap: { envelope: heapEnvelope, highWaterGrowth: heapHighWaterGrowth, floorGrowth: heapFloorGrowth },
    vram: vramEnvelope,
    maxResourceGrowth,
    lateFrameP95Ratio,
  };
}
