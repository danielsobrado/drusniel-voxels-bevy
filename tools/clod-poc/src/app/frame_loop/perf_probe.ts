import type { FramePerfMetric, FramePerfPhaseTiming, FramePerfSample, FramePerfSummary, FramePerfSnapshot, FramePerfHooks, FramePerfProbe } from "./perf_probe_types.js";
import { FRAME_PERF_ALL_METRICS, FRAME_PERF_BROAD_BUCKETS, FRAME_PERF_PROP_BUCKETS } from "./perf_probe_constants.js";
import { intParam, statsFor, rankBuckets, avgCounter, minPositiveCounter, avgGpuPasses, countTreeGpuStatuses, countCustomPropGpuStatuses } from "./perf_probe_helpers.js";

export type { FramePerfMetric, FramePerfBroadBucket, FramePerfPropBucket, FramePerfPhaseTiming, FramePerfSample, FramePerfMetricStats, FramePerfBucketRank, FramePerfSummary, FramePerfSnapshot, FramePerfHooks, FramePerfProbe } from "./perf_probe_types.js";
export { FRAME_PERF_BROAD_BUCKETS, FRAME_PERF_PROP_BUCKETS, FRAME_PERF_ALL_METRICS } from "./perf_probe_constants.js";

const RECENT_SAMPLE_LIMIT = 120;

declare global {
  interface Window {
    __drusnielPerf?: FramePerfHooks;
  }
}

export function createFramePerfPhaseTiming(): FramePerfPhaseTiming {
  return {
    frameSetupMs: 0,
    inputMs: 0,
    selectionUpdateMs: 0,
    clodApplyMs: 0,
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
    vegetationTotalMs: 0,
    borderOceanDebugMs: 0,
    statsSyncMs: 0,
  };
}

export function summarizeFramePerfSamples(samples: readonly FramePerfSample[], warmupFrames: number, targetSampleFrames: number): FramePerfSummary {
  const metrics = Object.fromEntries(FRAME_PERF_ALL_METRICS.map((m) => [m, statsFor(samples, m)])) as Record<FramePerfMetric, import("./perf_probe_types.js").FramePerfMetricStats>;
  const renderedTotal = samples.reduce((s, sample) => s + sample.renderedCount, 0);
  const trianglesTotal = samples.reduce((s, sample) => s + sample.terrainTriangles, 0);
  const vegetationGpuCandidatesBudgetBeforeReject =
    avgCounter(samples, "treeGpuCandidateCountBeforePrefilter") +
    avgCounter(samples, "grassGpuCandidateCountBeforePrefilter") +
    avgCounter(samples, "understoryGpuCandidateCountBeforePrefilter");
  const vegetationGpuCandidatesBudgetAfterReject =
    avgCounter(samples, "treeGpuCandidateCountAfterPrefilter") +
    avgCounter(samples, "grassGpuCandidateCountAfterPrefilter") +
    avgCounter(samples, "understoryGpuCandidateCountAfterPrefilter");
  const vegetationGpuCandidatesGenerated =
    avgCounter(samples, "treeGpuCandidateCount") +
    avgCounter(samples, "grassGpuCandidateCount") +
    avgCounter(samples, "understoryGpuCandidateCount");
  const treeRejectedClustersAvg = avgCounter(samples, "treeGpuPrefilterRejectedClusters");
  const treeVisibleClustersAvg = avgCounter(samples, "treeVisibleClusterVisible");
  const treeUnknownKeptClustersAvg = avgCounter(samples, "treeVisibleClusterUnknownKept");
  const treeAcceptedClustersAvg = Math.max(0, treeVisibleClustersAvg - treeUnknownKeptClustersAvg);
  const treeSourceFarSummaryAvg = avgCounter(samples, "treeGpuPrefilterSourceFarSummary");
  const treeSourceTerrainSamplerAvg = avgCounter(samples, "treeGpuPrefilterSourceTerrainSampler");
  const treeSourceFallbackAvg = avgCounter(samples, "treeGpuPrefilterSourceFallback");
  const grassSourceFarSummaryAvg = avgCounter(samples, "grassGpuPrefilterSourceFarSummary");
  const grassSourceTerrainSamplerAvg = avgCounter(samples, "grassGpuPrefilterSourceTerrainSampler");
  const grassSourceFallbackAvg = avgCounter(samples, "grassGpuPrefilterSourceFallback");
  const understorySourceFarSummaryAvg = avgCounter(samples, "understoryGpuPrefilterSourceFarSummary");
  const understorySourceTerrainSamplerAvg = avgCounter(samples, "understoryGpuPrefilterSourceTerrainSampler");
  const understorySourceFallbackAvg = avgCounter(samples, "understoryGpuPrefilterSourceFallback");
  const vegetationSourceFarSummaryAvg = treeSourceFarSummaryAvg + grassSourceFarSummaryAvg + understorySourceFarSummaryAvg;
  const vegetationSourceTerrainSamplerAvg = treeSourceTerrainSamplerAvg + grassSourceTerrainSamplerAvg + understorySourceTerrainSamplerAvg;
  const vegetationSourceFallbackAvg = treeSourceFallbackAvg + grassSourceFallbackAvg + understorySourceFallbackAvg;
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
      treeGpuCandidateCountBeforePrefilterAvg: avgCounter(samples, "treeGpuCandidateCountBeforePrefilter"),
      treeGpuCandidateCountAfterPrefilterAvg: avgCounter(samples, "treeGpuCandidateCountAfterPrefilter"),
      treeGpuPrefilterRejectedClustersAvg: treeRejectedClustersAvg,
      treeGpuPrefilterSkippedCandidateEstimateAvg: avgCounter(samples, "treeGpuPrefilterSkippedCandidateEstimate"),
      treeGpuPrefilterSourceFarSummaryAvg: treeSourceFarSummaryAvg,
      treeGpuPrefilterSourceTerrainSamplerAvg: treeSourceTerrainSamplerAvg,
      treeGpuPrefilterSourceFallbackAvg: treeSourceFallbackAvg,
      treeGpuAcceptedCountAvg: avgCounter(samples, "treeGpuAcceptedCount"),
      treeGpuVisibleCountAvg: avgCounter(samples, "treeGpuVisibleCount"),
      treeGpuShadowCasterCountAvg: avgCounter(samples, "treeGpuShadowCasterCount"),
      treeGpuShadowOverflowedFrames: samples.reduce((s, sample) => s + sample.treeGpuShadowOverflowed, 0),
      treeVisibleClusterHiddenAvg: avgCounter(samples, "treeVisibleClusterHidden"),
      treeVisibleClusterVisibleAvg: treeVisibleClustersAvg,
      treeVisibleClusterUnknownKeptAvg: treeUnknownKeptClustersAvg,
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
      grassGpuCandidateCountAvg: avgCounter(samples, "grassGpuCandidateCount"),
      grassGpuCandidateCountBeforePrefilterAvg: avgCounter(samples, "grassGpuCandidateCountBeforePrefilter"),
      grassGpuCandidateCountAfterPrefilterAvg: avgCounter(samples, "grassGpuCandidateCountAfterPrefilter"),
      grassGpuPrefilterSourceFarSummaryAvg: grassSourceFarSummaryAvg,
      grassGpuPrefilterSourceTerrainSamplerAvg: grassSourceTerrainSamplerAvg,
      grassGpuPrefilterSourceFallbackAvg: grassSourceFallbackAvg,
      grassGpuAcceptedCountAvg: avgCounter(samples, "grassGpuAcceptedCount"),
      grassGpuVisibleCountAvg: avgCounter(samples, "grassGpuVisibleCount"),
      understoryGpuCandidateCountAvg: avgCounter(samples, "understoryGpuCandidateCount"),
      understoryGpuCandidateCountBeforePrefilterAvg: avgCounter(samples, "understoryGpuCandidateCountBeforePrefilter"),
      understoryGpuCandidateCountAfterPrefilterAvg: avgCounter(samples, "understoryGpuCandidateCountAfterPrefilter"),
      understoryGpuPrefilterSourceFarSummaryAvg: understorySourceFarSummaryAvg,
      understoryGpuPrefilterSourceTerrainSamplerAvg: understorySourceTerrainSamplerAvg,
      understoryGpuPrefilterSourceFallbackAvg: understorySourceFallbackAvg,
      understoryGpuAcceptedCountAvg: avgCounter(samples, "understoryGpuAcceptedCount"),
      understoryGpuVisibleCountAvg: avgCounter(samples, "understoryGpuVisibleCount"),
      vegetationGpuClustersTotalAvg: treeRejectedClustersAvg + treeVisibleClustersAvg + treeUnknownKeptClustersAvg,
      vegetationGpuClustersRejectedEarlyAvg: treeRejectedClustersAvg,
      vegetationGpuClustersAcceptedAvg: treeAcceptedClustersAvg,
      vegetationGpuClustersSummaryMissingAvg: treeUnknownKeptClustersAvg,
      vegetationGpuSourceFarSummaryAvg: vegetationSourceFarSummaryAvg,
      vegetationGpuSourceTerrainSamplerAvg: vegetationSourceTerrainSamplerAvg,
      vegetationGpuSourceFallbackAvg: vegetationSourceFallbackAvg,
      vegetationGpuCandidatesBudgetBeforeRejectAvg: vegetationGpuCandidatesBudgetBeforeReject,
      vegetationGpuCandidatesBudgetAfterRejectAvg: vegetationGpuCandidatesBudgetAfterReject,
      vegetationGpuCandidatesGeneratedAvg: vegetationGpuCandidatesGenerated,
      vegetationGpuRejectOutsideTerrainAvg: 0,
      vegetationGpuRejectTerrainHiddenAvg: treeRejectedClustersAvg,
      vegetationGpuRejectNoCoverageAvg: 0,
      vegetationGpuRejectInvalidSurfaceAvg: 0,
      vegetationGpuEarlyRejectMsAvg: 0,
      customPropGpuStatusCounts: countCustomPropGpuStatuses(samples),
      customPropTotalInstancesAvg: avgCounter(samples, "customPropTotalInstances"),
      customPropVisibleInstancesAvg: avgCounter(samples, "customPropVisibleInstances"),
      customPropGpuCandidateCountAvg: avgCounter(samples, "customPropGpuCandidateCount"),
      customPropGpuVisibleCountAvg: avgCounter(samples, "customPropGpuVisibleCount"),
      customPropGpuOverflowedFrames: samples.reduce((s, sample) => s + sample.customPropGpuOverflowed, 0),
      customPropGpuDispatchMsAvg: avgCounter(samples, "customPropGpuDispatchMs"),
      dynamicResolutionActiveFrames: samples.reduce((s, sample) => s + sample.dynamicResolutionActive, 0),
      dynamicResolutionRenderScaleAvg: avgCounter(samples, "dynamicResolutionRenderScale"),
      dynamicResolutionAdjustmentsMax: samples.reduce((max, sample) => Math.max(max, sample.dynamicResolutionAdjustments), 0),
      statsSyncRuns: samples.reduce((max, sample) => Math.max(max, sample.statsSyncRuns), 0),
      statsSyncSkips: samples.reduce((max, sample) => Math.max(max, sample.statsSyncSkips), 0),
      statsSyncRanFrames: samples.reduce((s, sample) => s + sample.statsSyncRan, 0),
      statsSyncThrottleReasonCounts: countStatsSyncReasons(samples),
      statsSyncHzEffectiveAvg: avgCounter(samples, "statsSyncHzEffective"),
      gpuPassesAvg: avgGpuPasses(samples),
    },
  };
}

function countStatsSyncReasons(samples: readonly FramePerfSample[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sample of samples) {
    const key = String(sample.statsSyncThrottleReason);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function exposePerfHooks(hooks: FramePerfHooks | null): void {
  if (typeof window === "undefined") return;
  if (hooks) window.__drusnielPerf = hooks;
  else delete window.__drusnielPerf;
}

function appendRecentSample(recentSamples: FramePerfSample[], sample: FramePerfSample): void {
  recentSamples.push(sample);
  if (recentSamples.length > RECENT_SAMPLE_LIMIT) recentSamples.shift();
}

export function createFramePerfProbeFromQuery(searchParams: URLSearchParams): FramePerfProbe | null {
  if (searchParams.get("perfProbe") !== "1") {
    exposePerfHooks(null);
    return null;
  }
  const warmupFrames = intParam(searchParams, ["perfWarmupFrames", "perfWarmup"], 120);
  const targetSampleFrames = Math.max(1, intParam(searchParams, ["perfSampleFrames", "perfFrames"], 300));
  let observedFrames = 0;
  let samples: FramePerfSample[] = [];
  let recentSamples: FramePerfSample[] = [];
  const snapshot = (): FramePerfSnapshot => ({
    ready: samples.length >= targetSampleFrames,
    observedFrames,
    samples: samples.slice(),
    recentSamples: recentSamples.slice(),
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
    recentSamples,
    snapshot,
    reset: () => {
      observedFrames = 0;
      samples = [];
      recentSamples = [];
      hooks.ready = false;
      hooks.observedFrames = 0;
      hooks.sampleCount = 0;
      hooks.lastSample = null;
      hooks.samples = samples;
      hooks.recentSamples = recentSamples;
    },
  };
  exposePerfHooks(hooks);
  return {
    enabled: true,
    record(sample: FramePerfSample): void {
      observedFrames += 1;
      hooks.observedFrames = observedFrames;
      appendRecentSample(recentSamples, sample);
      hooks.recentSamples = recentSamples;
      hooks.lastSample = sample;
      if (observedFrames <= warmupFrames || samples.length >= targetSampleFrames) return;
      samples.push(sample);
      hooks.sampleCount = samples.length;
      hooks.ready = samples.length >= targetSampleFrames;
    },
    reset: hooks.reset,
    snapshot,
  };
}
