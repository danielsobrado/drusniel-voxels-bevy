import type { FramePerfMetric, FramePerfPhaseTiming, FramePerfSample, FramePerfSummary, FramePerfSnapshot, FramePerfHooks, FramePerfProbe } from "./perf_probe_types.js";
import { FRAME_PERF_ALL_METRICS, FRAME_PERF_BROAD_BUCKETS, FRAME_PERF_PROP_BUCKETS } from "./perf_probe_constants.js";
import { intParam, statsFor, rankBuckets, avgCounter, minPositiveCounter, avgGpuPasses, countTreeGpuStatuses, countCustomPropGpuStatuses } from "./perf_probe_helpers.js";

export type { FramePerfMetric, FramePerfBroadBucket, FramePerfPropBucket, FramePerfPhaseTiming, FramePerfSample, FramePerfMetricStats, FramePerfBucketRank, FramePerfSummary, FramePerfSnapshot, FramePerfHooks, FramePerfProbe } from "./perf_probe_types.js";
export { FRAME_PERF_BROAD_BUCKETS, FRAME_PERF_PROP_BUCKETS, FRAME_PERF_ALL_METRICS } from "./perf_probe_constants.js";

declare global {
  interface Window {
    __drusnielPerf?: FramePerfHooks;
  }
}

export function createFramePerfPhaseTiming(): FramePerfPhaseTiming {
  return {
    frameSetupMs: 0, selectionUpdateMs: 0, longViewDiagnosticsMs: 0, farSummaryMs: 0,
    constructionMs: 0, brushMs: 0, combatMs: 0, spellsMs: 0, terrainPhaseMs: 0,
    shadowProxyMs: 0, clodShadowMs: 0, canopyMs: 0, borderOceanDebugMs: 0, statsSyncMs: 0,
  };
}

export function summarizeFramePerfSamples(samples: readonly FramePerfSample[], warmupFrames: number, targetSampleFrames: number): FramePerfSummary {
  const metrics = Object.fromEntries(FRAME_PERF_ALL_METRICS.map((m) => [m, statsFor(samples, m)])) as Record<FramePerfMetric, import("./perf_probe_types.js").FramePerfMetricStats>;
  const renderedTotal = samples.reduce((s, sample) => s + sample.renderedCount, 0);
  const trianglesTotal = samples.reduce((s, sample) => s + sample.terrainTriangles, 0);
  return {
    sampleCount: samples.length, warmupFrames, targetSampleFrames, metrics,
    broadBucketsByP95: rankBuckets(metrics, FRAME_PERF_BROAD_BUCKETS),
    propBucketsByP95: rankBuckets(metrics, FRAME_PERF_PROP_BUCKETS),
    counters: {
      renderedCountAvg: samples.length > 0 ? renderedTotal / samples.length : 0,
      terrainTrianglesAvg: samples.length > 0 ? trianglesTotal / samples.length : 0,
      chunkGroupsBuiltTotal: samples.reduce((s, sample) => s + sample.chunkGroupsBuilt, 0),
      nearFieldChunkGroupsMax: samples.reduce((m, sample) => Math.max(m, sample.nearFieldChunkGroups), 0),
      treeGpuStatusCounts: countTreeGpuStatuses(samples),
      treeTotalTreesAvg: avgCounter(samples, "treeTotalTrees"),
      treeGpuCandidateCountAvg: avgCounter(samples, "treeGpuCandidateCount"),
      treeGpuAcceptedCountAvg: avgCounter(samples, "treeGpuAcceptedCount"),
      treeGpuVisibleCountAvg: avgCounter(samples, "treeGpuVisibleCount"),
      treeGpuShadowCasterCountAvg: avgCounter(samples, "treeGpuShadowCasterCount"),
      treeGpuShadowOverflowedFrames: samples.reduce((s, sample) => s + sample.treeGpuShadowOverflowed, 0),
      treeNearTreesAvg: avgCounter(samples, "treeNearTrees"),
      treeMidTreesAvg: avgCounter(samples, "treeMidTrees"),
      treeFarTreesAvg: avgCounter(samples, "treeFarTrees"),
      treeImpostorTreesAvg: avgCounter(samples, "treeImpostorTrees"),
      treeHeroNearTrianglesAvg: avgCounter(samples, "treeHeroNearTriangles"),
      treeHeroNearFoliageTrianglesAvg: avgCounter(samples, "treeHeroNearFoliageTriangles"),
      treeHeroNearMinTreeTrianglesMin: minPositiveCounter(samples, "treeHeroNearMinTreeTriangles"),
      treeHeroNearAvgTreeTrianglesAvg: avgCounter(samples, "treeHeroNearAvgTreeTriangles"),
      treeHeroNearPassesTriangleFloorFrames: samples.reduce((s, sample) => s + sample.treeHeroNearPassesTriangleFloor, 0),
      treeHeroNearPassesRealFoliageFrames: samples.reduce((s, sample) => s + sample.treeHeroNearPassesRealFoliage, 0),
      customPropGpuStatusCounts: countCustomPropGpuStatuses(samples),
      customPropTotalInstancesAvg: avgCounter(samples, "customPropTotalInstances"),
      customPropVisibleInstancesAvg: avgCounter(samples, "customPropVisibleInstances"),
      customPropGpuCandidateCountAvg: avgCounter(samples, "customPropGpuCandidateCount"),
      customPropGpuVisibleCountAvg: avgCounter(samples, "customPropGpuVisibleCount"),
      customPropGpuOverflowedFrames: samples.reduce((s, sample) => s + sample.customPropGpuOverflowed, 0),
      customPropGpuDispatchMsAvg: avgCounter(samples, "customPropGpuDispatchMs"),
      gpuPassesAvg: avgGpuPasses(samples),
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
    ready: samples.length >= targetSampleFrames, observedFrames, samples: samples.slice(),
    ...summarizeFramePerfSamples(samples, warmupFrames, targetSampleFrames),
  });
  const hooks: FramePerfHooks = {
    ready: false, observedFrames: 0, sampleCount: 0, warmupFrames, targetSampleFrames,
    lastSample: null, samples,
    snapshot,
    reset: () => { observedFrames = 0; samples = []; hooks.ready = false; hooks.observedFrames = 0; hooks.sampleCount = 0; hooks.lastSample = null; hooks.samples = samples; },
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
