import type { FramePerfMetric, FramePerfPhaseTiming, FramePerfSample, FramePerfSummary, FramePerfSnapshot, FramePerfHooks, FramePerfProbe } from "./perf_probe_types.js";
import { FRAME_PERF_ALL_METRICS, FRAME_PERF_BROAD_BUCKETS, FRAME_PERF_FAR_SUMMARY_BUCKETS, FRAME_PERF_PROP_BUCKETS } from "./perf_probe_constants.js";
import { intParam, statsFor, rankBuckets, avgCounter, minPositiveCounter, avgGpuPasses, countTreeGpuStatuses, countCustomPropGpuStatuses } from "./perf_probe_helpers.js";

export type { FramePerfMetric, FramePerfBroadBucket, FramePerfPropBucket, FramePerfPhaseTiming, FramePerfSample, FramePerfMetricStats, FramePerfBucketRank, FramePerfSummary, FramePerfSnapshot, FramePerfHooks, FramePerfProbe } from "./perf_probe_types.js";
export { FRAME_PERF_BROAD_BUCKETS, FRAME_PERF_PROP_BUCKETS, FRAME_PERF_ALL_METRICS } from "./perf_probe_constants.js";

const RECENT_SAMPLE_LIMIT = 1_320;
const MIRRORED_TOP_BUCKET_COUNT = 8;
// Summarizing every metric over the sample window (sort per metric) is far too heavy to run per
// frame; consumers poll the mirrored counters at >=250ms cadence, so mirror on that cadence plus
// the ready flip (harness gates key off framePerf.ready).
const MIRROR_INTERVAL_FRAMES = 15;
const MIRRORED_METRICS: readonly FramePerfMetric[] = [
  "frameMs",
  "renderMs",
  "selectionUpdateMs",
  "selectionMs",
  "selectionCutMs",
  "selectionBookMs",
  "selectionInfoMs",
  "selectionOverlaysMs",
  "selectionSub.settings",
  "selectionSub.params",
  "selectionSub.compute",
  "selectionSub.readback",
  "selectionSub.parity",
  "selectionSub.lookup",
  "selectionSub.cache",
  "selectionSub.cut",
  "selectionSub.book",
  "selectionSub.views",
  "selectionSub.markActive",
  "selectionSub.prefetch",
  "selectionSub.apply",
  "selectionSub.stats",
  "selectionSub.hash",
  "selectionSub.commit",
  "selectionSub.info",
  "selectionSub.overlays",
  "selectionSub.dispatch",
  "selectionSub.total",
  "clodApplyMs",
  "terrainPhaseMs",
  "bubbleMs",
  "farSummaryMs",
  ...FRAME_PERF_FAR_SUMMARY_BUCKETS,
  "longViewDiagnosticsMs",
  "vegetationTotalMs",
  "grassMs",
  "treesMs",
  "understoryMs",
  "forestLightingMs",
  "stonesMs",
  "customPropsMs",
  "waterMs",
  "deepOceanMs",
  "weatherMs",
  "statsSyncMs",
  "propsRestMs",
  "propsUnattributedMs",
  "unattributedMs",
  "otherMs",
];

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
    agentEnvelopeMs: 0,
    terrainPhaseMs: 0,
    shadowProxyMs: 0,
    clodShadowMs: 0,
    canopyMs: 0,
    vegetationTotalMs: 0,
    borderOceanDebugMs: 0,
    statsSyncMs: 0,
  };
}

function maxCounter(samples: readonly FramePerfSample[], key: string): number {
  return samples.reduce((max, sample) => Math.max(max, Number(sample[key] ?? 0)), 0);
}

function statsForNumbers(values: readonly number[]): import("./perf_probe_types.js").FramePerfMetricStats {
  const safeValues = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (safeValues.length === 0) return { avg: 0, min: 0, max: 0, p50: 0, p95: 0 };
  const percentile = (ratio: number): number => safeValues[Math.min(safeValues.length - 1, Math.max(0, Math.ceil(safeValues.length * ratio) - 1))] ?? 0;
  const total = safeValues.reduce((sum, value) => sum + value, 0);
  return {
    avg: total / safeValues.length,
    min: safeValues[0] ?? 0,
    max: safeValues[safeValues.length - 1] ?? 0,
    p50: percentile(0.5),
    p95: percentile(0.95),
  };
}

function numericSample(sample: FramePerfSample, key: string): number {
  const value = sample[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function hasNumericSample(sample: FramePerfSample, key: string): boolean {
  const value = sample[key];
  return typeof value === "number" && Number.isFinite(value);
}

function selectionOuterStats(samples: readonly FramePerfSample[]): Record<string, import("./perf_probe_types.js").FramePerfMetricStats> {
  const hasDirectSplit = samples.some((sample) => hasNumericSample(sample, "selectionOuter.updateCallMs") || hasNumericSample(sample, "selectionOuter.statsCallMs"));
  const updateValues = samples.map((sample) => hasDirectSplit ? numericSample(sample, "selectionOuter.updateCallMs") : numericSample(sample, "selectionSub.total"));
  const statsValues = samples.map((sample) => numericSample(sample, "selectionOuter.statsCallMs"));
  const wrapperValues = samples.map((sample) => numericSample(sample, "selectionOuter.wrapperGapMs"));
  return {
    totalMs: statsForNumbers(samples.map((sample) => numericSample(sample, "selectionUpdateMs"))),
    updateMs: statsForNumbers(updateValues),
    updateCallMs: statsForNumbers(updateValues),
    statsCallMs: statsForNumbers(statsValues),
    wrapperGapMs: statsForNumbers(wrapperValues),
    statsOrWrapperMs: statsForNumbers(samples.map((sample, index) => {
      if (hasDirectSplit) return statsValues[index] + wrapperValues[index];
      return Math.max(0, numericSample(sample, "selectionUpdateMs") - numericSample(sample, "selectionSub.total"));
    })),
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
  const treeFarSummaryConsultedAvg = avgCounter(samples, "treeGpuPrefilterFarSummaryConsulted");
  const treeSourceFarSummaryAvg = avgCounter(samples, "treeGpuPrefilterSourceFarSummary");
  const treeSourceTerrainSamplerAvg = avgCounter(samples, "treeGpuPrefilterSourceTerrainSampler");
  const treeSourceFallbackAvg = avgCounter(samples, "treeGpuPrefilterSourceFallback");
  const grassFarSummaryConsultedAvg = avgCounter(samples, "grassGpuPrefilterFarSummaryConsulted");
  const grassSourceFarSummaryAvg = avgCounter(samples, "grassGpuPrefilterSourceFarSummary");
  const grassSourceTerrainSamplerAvg = avgCounter(samples, "grassGpuPrefilterSourceTerrainSampler");
  const grassSourceFallbackAvg = avgCounter(samples, "grassGpuPrefilterSourceFallback");
  const understoryFarSummaryConsultedAvg = avgCounter(samples, "understoryGpuPrefilterFarSummaryConsulted");
  const understorySourceFarSummaryAvg = avgCounter(samples, "understoryGpuPrefilterSourceFarSummary");
  const understorySourceTerrainSamplerAvg = avgCounter(samples, "understoryGpuPrefilterSourceTerrainSampler");
  const understorySourceFallbackAvg = avgCounter(samples, "understoryGpuPrefilterSourceFallback");
  const vegetationFarSummaryConsultedAvg = treeFarSummaryConsultedAvg + grassFarSummaryConsultedAvg + understoryFarSummaryConsultedAvg;
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
      selectionCutCacheHitsMax: maxCounter(samples, "selectionCutCacheHits"),
      selectionCutCacheMissesMax: maxCounter(samples, "selectionCutCacheMisses"),
      selectionCutCacheInvalidationsMax: maxCounter(samples, "selectionCutCacheInvalidations"),
      selectionCutCacheLastReasonCode: samples.length > 0 ? Number(samples[samples.length - 1]?.selectionCutCacheLastReasonCode ?? -1) : -1,
      selectionCutCacheReasonCounts: countSelectionCacheReasons(samples),
      cachedFastHitsMax: maxCounter(samples, "cachedFastHits"),
      treeGpuStatusCounts: countTreeGpuStatuses(samples),
      treeTotalTreesAvg: avgCounter(samples, "treeTotalTrees"),
      treeGpuCandidateCountAvg: avgCounter(samples, "treeGpuCandidateCount"),
      treeGpuCandidateCountBeforePrefilterAvg: avgCounter(samples, "treeGpuCandidateCountBeforePrefilter"),
      treeGpuCandidateCountAfterPrefilterAvg: avgCounter(samples, "treeGpuCandidateCountAfterPrefilter"),
      treeGpuPrefilterRejectedClustersAvg: treeRejectedClustersAvg,
      treeGpuPrefilterSkippedCandidateEstimateAvg: avgCounter(samples, "treeGpuPrefilterSkippedCandidateEstimate"),
      treeGpuPrefilterFarSummaryConsultedAvg: treeFarSummaryConsultedAvg,
      treeGpuPrefilterSourceFarSummaryAvg: treeSourceFarSummaryAvg,
      treeGpuPrefilterSourceTerrainSamplerAvg: treeSourceTerrainSamplerAvg,
      treeGpuPrefilterSourceFallbackAvg: treeSourceFallbackAvg,
      treeGpuAcceptedCountAvg: avgCounter(samples, "treeGpuAcceptedCount"),
      treeGpuVisibleCountAvg: avgCounter(samples, "treeGpuVisibleCount"),
      treeGpuShadowCasterCountAvg: avgCounter(samples, "treeGpuShadowCasterCount"),
      treeGpuShadowOverflowedFrames: samples.reduce((s, sample) => s + Number(sample.treeGpuShadowOverflowed ?? 0), 0),
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
      treeHeroNearPassesTriangleFloorFrames: samples.reduce((s, sample) => s + Number(sample.treeHeroNearPassesTriangleFloor ?? 0), 0),
      treeHeroNearPassesRealFoliageFrames: samples.reduce((s, sample) => s + Number(sample.treeHeroNearPassesRealFoliage ?? 0), 0),
      grassGpuCandidateCountAvg: avgCounter(samples, "grassGpuCandidateCount"),
      grassGpuCandidateCountBeforePrefilterAvg: avgCounter(samples, "grassGpuCandidateCountBeforePrefilter"),
      grassGpuCandidateCountAfterPrefilterAvg: avgCounter(samples, "grassGpuCandidateCountAfterPrefilter"),
      grassGpuPrefilterFarSummaryConsultedAvg: grassFarSummaryConsultedAvg,
      grassGpuPrefilterSourceFarSummaryAvg: grassSourceFarSummaryAvg,
      grassGpuPrefilterSourceTerrainSamplerAvg: grassSourceTerrainSamplerAvg,
      grassGpuPrefilterSourceFallbackAvg: grassSourceFallbackAvg,
      grassGpuAcceptedCountAvg: avgCounter(samples, "grassGpuAcceptedCount"),
      grassGpuVisibleCountAvg: avgCounter(samples, "grassGpuVisibleCount"),
      understoryGpuCandidateCountAvg: avgCounter(samples, "understoryGpuCandidateCount"),
      understoryGpuCandidateCountBeforePrefilterAvg: avgCounter(samples, "understoryGpuCandidateCountBeforePrefilter"),
      understoryGpuCandidateCountAfterPrefilterAvg: avgCounter(samples, "understoryGpuCandidateCountAfterPrefilter"),
      understoryGpuPrefilterFarSummaryConsultedAvg: understoryFarSummaryConsultedAvg,
      understoryGpuPrefilterSourceFarSummaryAvg: understorySourceFarSummaryAvg,
      understoryGpuPrefilterSourceTerrainSamplerAvg: understorySourceTerrainSamplerAvg,
      understoryGpuPrefilterSourceFallbackAvg: understorySourceFallbackAvg,
      understoryGpuAcceptedCountAvg: avgCounter(samples, "understoryGpuAcceptedCount"),
      understoryGpuVisibleCountAvg: avgCounter(samples, "understoryGpuVisibleCount"),
      vegetationGpuClustersTotalAvg: treeRejectedClustersAvg + treeVisibleClustersAvg + treeUnknownKeptClustersAvg,
      vegetationGpuClustersRejectedEarlyAvg: treeRejectedClustersAvg,
      vegetationGpuClustersAcceptedAvg: treeAcceptedClustersAvg,
      vegetationGpuClustersSummaryMissingAvg: treeUnknownKeptClustersAvg,
      vegetationGpuFarSummaryConsultedAvg: vegetationFarSummaryConsultedAvg,
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
      customPropGpuOverflowedFrames: samples.reduce((s, sample) => s + Number(sample.customPropGpuOverflowed ?? 0), 0),
      customPropGpuDispatchMsAvg: avgCounter(samples, "customPropGpuDispatchMs"),
      dynamicResolutionActiveFrames: samples.reduce((s, sample) => s + Number(sample.dynamicResolutionActive ?? 0), 0),
      dynamicResolutionRenderScaleAvg: avgCounter(samples, "dynamicResolutionRenderScale"),
      dynamicResolutionAdjustmentsMax: samples.reduce((max, sample) => Math.max(max, Number(sample.dynamicResolutionAdjustments ?? 0)), 0),
      statsSyncRuns: samples.reduce((max, sample) => Math.max(max, Number(sample.statsSyncRuns ?? 0)), 0),
      statsSyncSkips: samples.reduce((max, sample) => Math.max(max, Number(sample.statsSyncSkips ?? 0)), 0),
      statsSyncRanFrames: samples.reduce((s, sample) => s + Number(sample.statsSyncRan ?? 0), 0),
      statsSyncThrottleReasonCounts: countStatsSyncReasons(samples),
      statsSyncHzEffectiveAvg: avgCounter(samples, "statsSyncHzEffective"),
      gpuPassesAvg: avgGpuPasses(samples),
      agentsTotalAvg: avgCounter(samples, "agentsTotal"),
      agentDrawsAvg: avgCounter(samples, "agentDraws"),
      agentAnimMsAvg: avgCounter(samples, "agentAnimMs"),
      agentsFullAvg: avgCounter(samples, "agentsFull"),
      agentsMidAvg: avgCounter(samples, "agentsMid"),
      agentsFrozenAvg: avgCounter(samples, "agentsFrozen"),
      agentSimMsAvg: avgCounter(samples, "agentSimMs"),
      agentTerrainQueryMsAvg: avgCounter(samples, "agentTerrainQueryMs"),
      wdAgentsFullAvg: avgCounter(samples, "wdAgentsFull"),
      wdAgentsMidAvg: avgCounter(samples, "wdAgentsMid"),
      wdAgentsFrozenAvg: avgCounter(samples, "wdAgentsFrozen"),
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

function countSelectionCacheReasons(samples: readonly FramePerfSample[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sample of samples) {
    const reason = sample.selectionCutCacheLastReason;
    if (typeof reason !== "string" || reason.length === 0) continue;
    counts[reason] = (counts[reason] ?? 0) + 1;
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

function clodCounters(): Record<string, number> | null {
  if (typeof window === "undefined") return null;
  const hooks = (window as typeof window & {
    __drusnielClod?: { stats?: { counters?: Record<string, number> } | null };
  }).__drusnielClod;
  return hooks?.stats?.counters ?? null;
}

function counter(counters: Readonly<Record<string, number>>, key: string, fallback: number): number {
  const value = counters[key];
  return Number.isFinite(value) ? value : fallback;
}

function acceptancePerfGateReady(enabled: boolean): boolean {
  if (!enabled) return true;
  const counters = clodCounters();
  if (!counters) return false;
  const farSummaryQuiet = counter(counters, "far_summary_tiles_missing", -1) === 0
    && counter(counters, "far_summary_tiles_building", -1) === 0
    && counter(counters, "far_clipmap_pending_tiles", 0) === 0;
  const bubbleRequired = counter(counters, "live_bubble_required_pages", -1);
  const bubbleQuiet = bubbleRequired === 0 || (
    counter(counters, "live_bubble_failed_pages", -1) === 0
    && counter(counters, "live_bubble_gpu_retry_pages", 0) === 0
    && counter(counters, "live_bubble_building_pages", -1) === 0
    && counter(counters, "live_bubble_pending_chunks", 0) === 0
    && counter(counters, "live_bubble_inflight_chunks", 0) === 0
    && counter(counters, "live_bubble_ready_pages", 0) > 0
  );
  const streamRequired = counter(counters, "live_clod_stream_required_pages", 0);
  const streamQuiet = streamRequired === 0 || (
    counter(counters, "live_clod_stream_failed_pages", 0) === 0
    && counter(counters, "live_clod_stream_safety_cache_capacity_ok", 1) !== 0
    && counter(counters, "live_clod_stream_safety_pending_pages", 0) === 0
    && counter(counters, "live_clod_stream_safety_inflight_pages", 0) === 0
    && counter(counters, "live_clod_stream_parent_coverage_violations", 0) === 0
    && counter(counters, "live_clod_stream_active_root_pages", 0) > 0
  );
  return farSummaryQuiet
    && counter(counters, "far_shell_rebuild_pending", 0) === 0
    && counter(counters, "terrain_texture_window_pending", 0) === 0
    && bubbleQuiet
    && streamQuiet
    && counter(counters, "shadow_proxy_building", 0) !== 1;
}

function mirrorStats(counters: Record<string, number>, prefix: string, stats: import("./perf_probe_types.js").FramePerfMetricStats): void {
  counters[`framePerf.avg.${prefix}`] = stats.avg;
  counters[`framePerf.p50.${prefix}`] = stats.p50;
  counters[`framePerf.p95.${prefix}`] = stats.p95;
  counters[`framePerf.max.${prefix}`] = stats.max;
}

function mirrorFramePerfCounters(
  snapshot: FramePerfSnapshot,
  diagnostics: { ignoredConvergenceFrames: number; acceptanceGateReady: boolean },
): void {
  const counters = clodCounters();
  if (!counters) return;
  counters["framePerf.enabled"] = 1;
  counters["framePerf.ready"] = snapshot.ready ? 1 : 0;
  counters["framePerf.acceptanceGateReady"] = diagnostics.acceptanceGateReady ? 1 : 0;
  counters["framePerf.ignoredConvergenceFrames"] = diagnostics.ignoredConvergenceFrames;
  counters["framePerf.observedFrames"] = snapshot.observedFrames;
  counters["framePerf.sampleCount"] = snapshot.sampleCount;
  counters["framePerf.warmupFrames"] = snapshot.warmupFrames;
  counters["framePerf.targetSampleFrames"] = snapshot.targetSampleFrames;
  for (const metric of MIRRORED_METRICS) {
    const stats = snapshot.metrics[metric];
    if (!stats) continue;
    counters[`framePerf.avg.${metric}`] = stats.avg;
    counters[`framePerf.p50.${metric}`] = stats.p50;
    counters[`framePerf.p95.${metric}`] = stats.p95;
    counters[`framePerf.max.${metric}`] = stats.max;
  }
  const outerStats = selectionOuterStats(snapshot.samples);
  mirrorStats(counters, "selectionOuter.totalMs", outerStats.totalMs);
  mirrorStats(counters, "selectionOuter.updateMs", outerStats.updateMs);
  mirrorStats(counters, "selectionOuter.updateCallMs", outerStats.updateCallMs);
  mirrorStats(counters, "selectionOuter.statsCallMs", outerStats.statsCallMs);
  mirrorStats(counters, "selectionOuter.wrapperGapMs", outerStats.wrapperGapMs);
  mirrorStats(counters, "selectionOuter.statsOrWrapperMs", outerStats.statsOrWrapperMs);
  snapshot.broadBucketsByP95.slice(0, MIRRORED_TOP_BUCKET_COUNT).forEach((bucket, index) => {
    counters[`framePerf.topBroad.${index}.p95`] = bucket.p95;
    counters[`framePerf.topBroad.${index}.avg`] = bucket.avg;
    counters[`framePerf.p95.${bucket.name}`] = bucket.p95;
    counters[`framePerf.avg.${bucket.name}`] = bucket.avg;
  });
  snapshot.propBucketsByP95.slice(0, MIRRORED_TOP_BUCKET_COUNT).forEach((bucket, index) => {
    counters[`framePerf.topProp.${index}.p95`] = bucket.p95;
    counters[`framePerf.topProp.${index}.avg`] = bucket.avg;
    counters[`framePerf.p95.${bucket.name}`] = bucket.p95;
    counters[`framePerf.avg.${bucket.name}`] = bucket.avg;
  });
  counters["framePerf.renderedCountAvg"] = snapshot.counters.renderedCountAvg;
  counters["framePerf.terrainTrianglesAvg"] = snapshot.counters.terrainTrianglesAvg;
  counters["framePerf.selectionCutCache.hitsMax"] = snapshot.counters.selectionCutCacheHitsMax;
  counters["framePerf.selectionCutCache.missesMax"] = snapshot.counters.selectionCutCacheMissesMax;
  counters["framePerf.selectionCutCache.invalidationsMax"] = snapshot.counters.selectionCutCacheInvalidationsMax;
  counters["framePerf.selectionCutCache.lastReasonCode"] = snapshot.counters.selectionCutCacheLastReasonCode;
  counters["framePerf.cachedFastHitsMax"] = snapshot.counters.cachedFastHitsMax;
  for (const [reason, count] of Object.entries(snapshot.counters.selectionCutCacheReasonCounts ?? {})) {
    counters[`framePerf.selectionCutCache.reason.${reason}`] = Number(count) || 0;
  }
  counters["framePerf.dynamicResolutionRenderScaleAvg"] = snapshot.counters.dynamicResolutionRenderScaleAvg;
  counters["framePerf.dynamicResolutionActiveFrames"] = snapshot.counters.dynamicResolutionActiveFrames;
  counters["framePerf.statsSyncRanFrames"] = snapshot.counters.statsSyncRanFrames;
  counters["framePerf.treeGpuCandidateCountAvg"] = snapshot.counters.treeGpuCandidateCountAvg;
  counters["framePerf.grassGpuCandidateCountAvg"] = snapshot.counters.grassGpuCandidateCountAvg;
  counters["framePerf.understoryGpuCandidateCountAvg"] = snapshot.counters.understoryGpuCandidateCountAvg;
  counters["framePerf.vegetationGpuCandidatesGeneratedAvg"] = snapshot.counters.vegetationGpuCandidatesGeneratedAvg;
}

export function createFramePerfProbeFromQuery(searchParams: URLSearchParams): FramePerfProbe | null {
  if (searchParams.get("perfProbe") !== "1") {
    exposePerfHooks(null);
    return null;
  }
  const warmupFrames = intParam(searchParams, ["perfWarmupFrames", "perfWarmup"], 120);
  const targetSampleFrames = Math.max(1, intParam(searchParams, ["perfSampleFrames", "perfFrames"], 300));
  const gateAcceptanceConvergence = searchParams.get("acceptance") === "1" && searchParams.get("perfProbeConvergenceGate") !== "0";
  let observedFrames = 0;
  let ignoredConvergenceFrames = 0;
  let samples: FramePerfSample[] = [];
  let recentSamples: FramePerfSample[] = [];
  let framesSinceMirror = MIRROR_INTERVAL_FRAMES;
  let mirroredReady = false;
  const snapshot = (): FramePerfSnapshot => ({
    ready: samples.length >= targetSampleFrames,
    observedFrames,
    samples: samples.slice(),
    recentSamples: recentSamples.slice(),
    ...summarizeFramePerfSamples(samples, warmupFrames, targetSampleFrames),
  });
  const diagnostics = (): { ignoredConvergenceFrames: number; acceptanceGateReady: boolean } => ({
    ignoredConvergenceFrames,
    acceptanceGateReady: acceptancePerfGateReady(gateAcceptanceConvergence),
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
      ignoredConvergenceFrames = 0;
      samples = [];
      recentSamples = [];
      framesSinceMirror = MIRROR_INTERVAL_FRAMES;
      mirroredReady = false;
      hooks.ready = false;
      hooks.observedFrames = 0;
      hooks.sampleCount = 0;
      hooks.lastSample = null;
      hooks.samples = samples;
      hooks.recentSamples = recentSamples;
      mirrorFramePerfCounters(snapshot(), diagnostics());
    },
  };
  exposePerfHooks(hooks);
  mirrorFramePerfCounters(snapshot(), diagnostics());
  return {
    enabled: true,
    record(sample: FramePerfSample): void {
      const gateReady = acceptancePerfGateReady(gateAcceptanceConvergence);
      appendRecentSample(recentSamples, sample);
      hooks.recentSamples = recentSamples;
      hooks.lastSample = sample;
      if (gateReady) {
        observedFrames += 1;
        hooks.observedFrames = observedFrames;
        if (observedFrames > warmupFrames && samples.length < targetSampleFrames) {
          samples.push(sample);
          hooks.sampleCount = samples.length;
          hooks.ready = samples.length >= targetSampleFrames;
        }
      } else {
        ignoredConvergenceFrames += 1;
      }
      framesSinceMirror += 1;
      const readyFlipped = hooks.ready !== mirroredReady;
      if (framesSinceMirror < MIRROR_INTERVAL_FRAMES && !readyFlipped) return;
      framesSinceMirror = 0;
      mirroredReady = hooks.ready;
      mirrorFramePerfCounters(snapshot(), { ignoredConvergenceFrames, acceptanceGateReady: gateReady });
    },
    reset: hooks.reset,
    snapshot,
  };
}
