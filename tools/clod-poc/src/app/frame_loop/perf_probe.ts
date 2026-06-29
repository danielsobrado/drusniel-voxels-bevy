import type { PlayerInteractionMode } from "../../player_controller.js";
import type { TreeStats } from "../../trees/index.js";
import type { PropGpuStatus } from "../../props/prop_types.js";

export const FRAME_PERF_BROAD_BUCKETS = [
  "frameSetupMs",
  "selectionUpdateMs",
  "longViewDiagnosticsMs",
  "farSummaryMs",
  "constructionMs",
  "brushMs",
  "combatMs",
  "spellsMs",
  "terrainPhaseMs",
  "shadowProxyMs",
  "clodShadowMs",
  "canopyMs",
  "vegetationTotalMs",
  "borderOceanDebugMs",
  "statsSyncMs",
  "renderMs",
  "unattributedMs",
] as const;

export const FRAME_PERF_PROP_BUCKETS = [
  "grassMs",
  "treesMs",
  "understoryMs",
  "forestLightingMs",
  "stonesMs",
  "customPropsMs",
  "waterMs",
  "deepOceanMs",
  "weatherMs",
  "propsRestMs",
  "propsUnattributedMs",
] as const;

export const FRAME_PERF_ALL_METRICS = [
  "frameMs",
  "selectionMs",
  "bubbleMs",
  "propsMs",
  "otherMs",
  ...FRAME_PERF_BROAD_BUCKETS,
  "selectionCutMs",
  "selectionBookMs",
  "selectionInfoMs",
  "selectionOverlaysMs",
  "vegetationTotalMs",
  ...FRAME_PERF_PROP_BUCKETS,
] as const;

export type FramePerfMetric = typeof FRAME_PERF_ALL_METRICS[number];
export type FramePerfBroadBucket = typeof FRAME_PERF_BROAD_BUCKETS[number];
export type FramePerfPropBucket = typeof FRAME_PERF_PROP_BUCKETS[number];

export interface FramePerfPhaseTiming {
  frameSetupMs: number;
  selectionUpdateMs: number;
  longViewDiagnosticsMs: number;
  farSummaryMs: number;
  constructionMs: number;
  brushMs: number;
  combatMs: number;
  spellsMs: number;
  terrainPhaseMs: number;
  shadowProxyMs: number;
  clodShadowMs: number;
  canopyMs: number;
  borderOceanDebugMs: number;
  statsSyncMs: number;
}

export interface FramePerfSample extends Record<FramePerfMetric, number> {
  frameId: number;
  renderedCount: number;
  terrainTriangles: number;
  chunkGroupsBuilt: number;
  nearFieldChunkGroups: number;
  interactionMode: PlayerInteractionMode;
  treeGpuStatus: TreeStats["gpuStatus"] | "unknown";
  treeTotalTrees: number;
  treeVisiblePatches: number;
  treePatches: number;
  treeNearTrees: number;
  treeMidTrees: number;
  treeFarTrees: number;
  treeImpostorTrees: number;
  treeGpuCandidateCount: number;
  treeGpuAcceptedCount: number;
  treeGpuVisibleCount: number;
  treeGpuDispatchMs: number | null;
  customPropGpuStatus: PropGpuStatus | "unknown";
  customPropTotalInstances: number;
  customPropVisibleInstances: number;
  customPropGpuCandidateCount: number;
  customPropGpuVisibleCount: number;
  customPropGpuOverflowed: number;
  customPropGpuDispatchMs: number | null;
  gpuRenderMs?: number; // [DEBUG-bs9f] resolved GPU render-pass time (ms)
  gpuComputeMs?: number; // [DEBUG-bs9f] resolved GPU compute-pass time (ms)
  drawCalls?: number; // [DEBUG-bs9f] renderer.info.render.drawCalls (all passes this frame)
  totalTriangles?: number; // [DEBUG-bs9f] renderer.info.render.triangles (all passes this frame)
}

export interface FramePerfMetricStats {
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
}

export interface FramePerfBucketRank {
  name: string;
  p95: number;
  avg: number;
}

export interface FramePerfSummary {
  sampleCount: number;
  warmupFrames: number;
  targetSampleFrames: number;
  metrics: Record<FramePerfMetric, FramePerfMetricStats>;
  broadBucketsByP95: FramePerfBucketRank[];
  propBucketsByP95: FramePerfBucketRank[];
  counters: {
    renderedCountAvg: number;
    terrainTrianglesAvg: number;
    chunkGroupsBuiltTotal: number;
    nearFieldChunkGroupsMax: number;
    treeGpuStatusCounts: Record<string, number>;
    treeTotalTreesAvg: number;
    treeGpuCandidateCountAvg: number;
    treeGpuAcceptedCountAvg: number;
    treeGpuVisibleCountAvg: number;
    treeNearTreesAvg: number;
    treeMidTreesAvg: number;
    treeFarTreesAvg: number;
    treeImpostorTreesAvg: number;
    customPropGpuStatusCounts: Record<string, number>;
    customPropTotalInstancesAvg: number;
    customPropVisibleInstancesAvg: number;
    customPropGpuCandidateCountAvg: number;
    customPropGpuVisibleCountAvg: number;
    customPropGpuOverflowedFrames: number;
    customPropGpuDispatchMsAvg: number;
  };
}

export function createFramePerfPhaseTiming(): FramePerfPhaseTiming {
  return {
    frameSetupMs: 0,
    selectionUpdateMs: 0,
    longViewDiagnosticsMs: 0,
    farSummaryMs: 0,
    constructionMs: 0,
    brushMs: 0,
    combatMs: 0,
    spellsMs: 0,
    terrainPhaseMs: 0,
    shadowProxyMs: 0,
    clodShadowMs: 0,
    canopyMs: 0,
    borderOceanDebugMs: 0,
    statsSyncMs: 0,
  };
}

export interface FramePerfSnapshot extends FramePerfSummary {
  ready: boolean;
  observedFrames: number;
  samples: FramePerfSample[];
}

export interface FramePerfHooks {
  ready: boolean;
  observedFrames: number;
  sampleCount: number;
  warmupFrames: number;
  targetSampleFrames: number;
  lastSample: FramePerfSample | null;
  samples: FramePerfSample[];
  snapshot: () => FramePerfSnapshot;
  reset: () => void;
}

export interface FramePerfProbe {
  readonly enabled: boolean;
  record(sample: FramePerfSample): void;
  reset(): void;
  snapshot(): FramePerfSnapshot;
}

declare global {
  interface Window {
    __drusnielPerf?: FramePerfHooks;
  }
}

function intParam(searchParams: URLSearchParams, keys: readonly string[], fallback: number): number {
  for (const key of keys) {
    const raw = searchParams.get(key);
    if (raw === null) continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  return fallback;
}

function emptyMetricStats(): FramePerfMetricStats {
  return { avg: 0, min: 0, max: 0, p50: 0, p95: 0 };
}

function percentile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}

function statsFor(samples: readonly FramePerfSample[], metric: FramePerfMetric): FramePerfMetricStats {
  if (samples.length === 0) return emptyMetricStats();
  const values = samples.map((sample) => sample[metric]).sort((a, b) => a - b);
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    avg: total / values.length,
    min: values[0] ?? 0,
    max: values[values.length - 1] ?? 0,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
  };
}

function rankBuckets(
  metrics: Record<FramePerfMetric, FramePerfMetricStats>,
  bucketNames: readonly FramePerfMetric[],
): FramePerfBucketRank[] {
  return bucketNames
    .map((name) => ({ name, p95: metrics[name].p95, avg: metrics[name].avg }))
    .sort((a, b) => b.p95 - a.p95);
}

function avgCounter(samples: readonly FramePerfSample[], key: keyof FramePerfSample): number {
  if (samples.length === 0) return 0;
  const total = samples.reduce((sum, sample) => {
    const value = sample[key];
    return typeof value === "number" ? sum + value : sum;
  }, 0);
  return total / samples.length;
}

function countTreeGpuStatuses(samples: readonly FramePerfSample[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sample of samples) {
    counts[sample.treeGpuStatus] = (counts[sample.treeGpuStatus] ?? 0) + 1;
  }
  return counts;
}

function countCustomPropGpuStatuses(samples: readonly FramePerfSample[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sample of samples) {
    counts[sample.customPropGpuStatus] = (counts[sample.customPropGpuStatus] ?? 0) + 1;
  }
  return counts;
}

export function summarizeFramePerfSamples(
  samples: readonly FramePerfSample[],
  warmupFrames: number,
  targetSampleFrames: number,
): FramePerfSummary {
  const metrics = Object.fromEntries(
    FRAME_PERF_ALL_METRICS.map((metric) => [metric, statsFor(samples, metric)]),
  ) as Record<FramePerfMetric, FramePerfMetricStats>;
  const renderedTotal = samples.reduce((sum, sample) => sum + sample.renderedCount, 0);
  const trianglesTotal = samples.reduce((sum, sample) => sum + sample.terrainTriangles, 0);
  return {
    sampleCount: samples.length,
    warmupFrames,
    targetSampleFrames,
    metrics,
    broadBucketsByP95: rankBuckets(metrics, FRAME_PERF_BROAD_BUCKETS),
    propBucketsByP95: rankBuckets(metrics, FRAME_PERF_PROP_BUCKETS),
    counters: {
      renderedCountAvg: samples.length > 0 ? renderedTotal / samples.length : 0,
      terrainTrianglesAvg: samples.length > 0 ? trianglesTotal / samples.length : 0,
      chunkGroupsBuiltTotal: samples.reduce((sum, sample) => sum + sample.chunkGroupsBuilt, 0),
      nearFieldChunkGroupsMax: samples.reduce((max, sample) => Math.max(max, sample.nearFieldChunkGroups), 0),
      treeGpuStatusCounts: countTreeGpuStatuses(samples),
      treeTotalTreesAvg: avgCounter(samples, "treeTotalTrees"),
      treeGpuCandidateCountAvg: avgCounter(samples, "treeGpuCandidateCount"),
      treeGpuAcceptedCountAvg: avgCounter(samples, "treeGpuAcceptedCount"),
      treeGpuVisibleCountAvg: avgCounter(samples, "treeGpuVisibleCount"),
      treeNearTreesAvg: avgCounter(samples, "treeNearTrees"),
      treeMidTreesAvg: avgCounter(samples, "treeMidTrees"),
      treeFarTreesAvg: avgCounter(samples, "treeFarTrees"),
      treeImpostorTreesAvg: avgCounter(samples, "treeImpostorTrees"),
      customPropGpuStatusCounts: countCustomPropGpuStatuses(samples),
      customPropTotalInstancesAvg: avgCounter(samples, "customPropTotalInstances"),
      customPropVisibleInstancesAvg: avgCounter(samples, "customPropVisibleInstances"),
      customPropGpuCandidateCountAvg: avgCounter(samples, "customPropGpuCandidateCount"),
      customPropGpuVisibleCountAvg: avgCounter(samples, "customPropGpuVisibleCount"),
      customPropGpuOverflowedFrames: samples.reduce((sum, sample) => sum + sample.customPropGpuOverflowed, 0),
      customPropGpuDispatchMsAvg: avgCounter(samples, "customPropGpuDispatchMs"),
    },
  };
}

export function createFramePerfProbeFromQuery(searchParams: URLSearchParams): FramePerfProbe | null {
  if (searchParams.get("perfProbe") !== "1") {
    delete window.__drusnielPerf;
    return null;
  }

  const warmupFrames = intParam(searchParams, ["perfWarmupFrames", "perfWarmup"], 120);
  const targetSampleFrames = Math.max(1, intParam(searchParams, ["perfSampleFrames", "perfFrames"], 300));
  let observedFrames = 0;
  let samples: FramePerfSample[] = [];

  const snapshot = (): FramePerfSnapshot => ({
    ready: samples.length >= targetSampleFrames,
    observedFrames,
    samples: samples.slice(),
    ...summarizeFramePerfSamples(samples, warmupFrames, targetSampleFrames),
  });

  const hooks: FramePerfHooks = {
    ready: false,
    observedFrames: 0,
    sampleCount: 0,
    warmupFrames,
    targetSampleFrames,
    lastSample: null,
    samples,
    snapshot,
    reset: () => {
      observedFrames = 0;
      samples = [];
      hooks.ready = false;
      hooks.observedFrames = 0;
      hooks.sampleCount = 0;
      hooks.lastSample = null;
      hooks.samples = samples;
    },
  };
  window.__drusnielPerf = hooks;

  return {
    enabled: true,
    record(sample: FramePerfSample): void {
      observedFrames += 1;
      hooks.observedFrames = observedFrames;
      if (observedFrames <= warmupFrames || samples.length >= targetSampleFrames) return;
      samples.push(sample);
      hooks.lastSample = sample;
      hooks.sampleCount = samples.length;
      hooks.ready = samples.length >= targetSampleFrames;
    },
    reset: hooks.reset,
    snapshot,
  };
}
