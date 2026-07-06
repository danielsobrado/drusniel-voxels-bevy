import type { PlayerInteractionMode } from "../../player_controller.js";
import type { TreeStats } from "../../trees/index.js";
import type { PropGpuStatus } from "../../props/prop_types.js";
import type { FramePerfMetric } from "./perf_probe_constants.js";
import type { StatsSyncThrottleReason } from "./stats_sync_throttle.js";

export type { FramePerfMetric };
export type FramePerfBroadBucket = import("./perf_probe_constants.js").FramePerfBroadBucket;
export type FramePerfPropBucket = import("./perf_probe_constants.js").FramePerfPropBucket;

export interface FramePerfPhaseTiming {
  frameSetupMs: number;
  inputMs: number;
  selectionUpdateMs: number;
  streamingRootUpdateMs: number;
  selectionCoreMs: number;
  clodApplyMs: number;
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
  vegetationTotalMs: number;
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
  treeHeroNearTriangles: number;
  treeHeroNearFoliageTriangles: number;
  treeHeroNearMinTreeTriangles: number;
  treeHeroNearAvgTreeTriangles: number;
  treeHeroNearPassesTriangleFloor: number;
  treeHeroNearPassesRealFoliage: number;
  treeGpuCandidateCount: number;
  treeGpuCandidateCountBeforePrefilter: number;
  treeGpuCandidateCountAfterPrefilter: number;
  treeGpuPrefilterRejectedClusters: number;
  treeGpuPrefilterSkippedCandidateEstimate: number;
  treeGpuPrefilterFarSummaryConsulted: number;
  treeGpuPrefilterSourceFarSummary: number;
  treeGpuPrefilterSourceTerrainSampler: number;
  treeGpuPrefilterSourceFallback: number;
  treeGpuAcceptedCount: number;
  treeGpuVisibleCount: number;
  treeGpuShadowCasterCount: number;
  treeGpuShadowOverflowed: number;
  treeGpuDispatchMs: number | null;
  treeVisibleClusterHidden: number;
  treeVisibleClusterVisible: number;
  treeVisibleClusterUnknownKept: number;
  grassGpuCandidateCount: number;
  grassGpuCandidateCountBeforePrefilter: number;
  grassGpuCandidateCountAfterPrefilter: number;
  grassGpuPrefilterFarSummaryConsulted: number;
  grassGpuPrefilterSourceFarSummary: number;
  grassGpuPrefilterSourceTerrainSampler: number;
  grassGpuPrefilterSourceFallback: number;
  grassGpuAcceptedCount: number;
  grassGpuVisibleCount: number;
  understoryGpuCandidateCount: number;
  understoryGpuCandidateCountBeforePrefilter: number;
  understoryGpuCandidateCountAfterPrefilter: number;
  understoryGpuPrefilterFarSummaryConsulted: number;
  understoryGpuPrefilterSourceFarSummary: number;
  understoryGpuPrefilterSourceTerrainSampler: number;
  understoryGpuPrefilterSourceFallback: number;
  understoryGpuAcceptedCount: number;
  understoryGpuVisibleCount: number;
  customPropGpuStatus: PropGpuStatus | "unknown";
  customPropTotalInstances: number;
  customPropVisibleInstances: number;
  customPropGpuCandidateCount: number;
  customPropGpuVisibleCount: number;
  customPropGpuOverflowed: number;
  customPropGpuDispatchMs: number | null;
  dynamicResolutionActive: number;
  dynamicResolutionRenderScale: number;
  dynamicResolutionAdjustments: number;
  gpuPasses?: Record<string, number>;
  statsSyncRan: number;
  statsSyncRuns: number;
  statsSyncSkips: number;
  statsSyncThrottleReason: StatsSyncThrottleReason;
  statsSyncHzEffective: number;
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
    treeGpuCandidateCountBeforePrefilterAvg: number;
    treeGpuCandidateCountAfterPrefilterAvg: number;
    treeGpuPrefilterRejectedClustersAvg: number;
    treeGpuPrefilterSkippedCandidateEstimateAvg: number;
    treeGpuPrefilterFarSummaryConsultedAvg: number;
    treeGpuPrefilterSourceFarSummaryAvg: number;
    treeGpuPrefilterSourceTerrainSamplerAvg: number;
    treeGpuPrefilterSourceFallbackAvg: number;
    treeGpuAcceptedCountAvg: number;
    treeGpuVisibleCountAvg: number;
    treeGpuShadowCasterCountAvg: number;
    treeGpuShadowOverflowedFrames: number;
    treeVisibleClusterHiddenAvg: number;
    treeVisibleClusterVisibleAvg: number;
    treeVisibleClusterUnknownKeptAvg: number;
    treeNearTreesAvg: number;
    treeMidTreesAvg: number;
    treeFarTreesAvg: number;
    treeImpostorTreesAvg: number;
    treeHeroNearTrianglesAvg: number;
    treeHeroNearFoliageTrianglesAvg: number;
    treeHeroNearMinTreeTrianglesMin: number;
    treeHeroNearAvgTreeTrianglesAvg: number;
    treeHeroNearPassesTriangleFloorFrames: number;
    treeHeroNearPassesRealFoliageFrames: number;
    grassGpuCandidateCountAvg: number;
    grassGpuCandidateCountBeforePrefilterAvg: number;
    grassGpuCandidateCountAfterPrefilterAvg: number;
    grassGpuPrefilterFarSummaryConsultedAvg: number;
    grassGpuPrefilterSourceFarSummaryAvg: number;
    grassGpuPrefilterSourceTerrainSamplerAvg: number;
    grassGpuPrefilterSourceFallbackAvg: number;
    grassGpuAcceptedCountAvg: number;
    grassGpuVisibleCountAvg: number;
    understoryGpuCandidateCountAvg: number;
    understoryGpuCandidateCountBeforePrefilterAvg: number;
    understoryGpuCandidateCountAfterPrefilterAvg: number;
    understoryGpuPrefilterFarSummaryConsultedAvg: number;
    understoryGpuPrefilterSourceFarSummaryAvg: number;
    understoryGpuPrefilterSourceTerrainSamplerAvg: number;
    understoryGpuPrefilterSourceFallbackAvg: number;
    understoryGpuAcceptedCountAvg: number;
    understoryGpuVisibleCountAvg: number;
    vegetationGpuClustersTotalAvg: number;
    vegetationGpuClustersRejectedEarlyAvg: number;
    vegetationGpuClustersAcceptedAvg: number;
    vegetationGpuClustersSummaryMissingAvg: number;
    vegetationGpuFarSummaryConsultedAvg: number;
    vegetationGpuSourceFarSummaryAvg: number;
    vegetationGpuSourceTerrainSamplerAvg: number;
    vegetationGpuSourceFallbackAvg: number;
    vegetationGpuCandidatesBudgetBeforeRejectAvg: number;
    vegetationGpuCandidatesBudgetAfterRejectAvg: number;
    vegetationGpuCandidatesGeneratedAvg: number;
    vegetationGpuRejectOutsideTerrainAvg: number;
    vegetationGpuRejectTerrainHiddenAvg: number;
    vegetationGpuRejectNoCoverageAvg: number;
    vegetationGpuRejectInvalidSurfaceAvg: number;
    vegetationGpuEarlyRejectMsAvg: number;
    customPropGpuStatusCounts: Record<string, number>;
    customPropTotalInstancesAvg: number;
    customPropVisibleInstancesAvg: number;
    customPropGpuCandidateCountAvg: number;
    customPropGpuVisibleCountAvg: number;
    customPropGpuOverflowedFrames: number;
    customPropGpuDispatchMsAvg: number;
    dynamicResolutionActiveFrames: number;
    dynamicResolutionRenderScaleAvg: number;
    dynamicResolutionAdjustmentsMax: number;
    statsSyncRuns: number;
    statsSyncSkips: number;
    statsSyncRanFrames: number;
    statsSyncThrottleReasonCounts: Record<string, number>;
    statsSyncHzEffectiveAvg: number;
    gpuPassesAvg: Record<string, number>;
  };
}

export interface FramePerfSnapshot extends FramePerfSummary {
  ready: boolean;
  observedFrames: number;
  samples: FramePerfSample[];
  recentSamples: FramePerfSample[];
}

export interface FramePerfHooks {
  ready: boolean;
  observedFrames: number;
  sampleCount: number;
  warmupFrames: number;
  targetSampleFrames: number;
  lastSample: FramePerfSample | null;
  samples: FramePerfSample[];
  recentSamples: FramePerfSample[];
  snapshot: () => FramePerfSnapshot;
  reset: () => void;
}

export interface FramePerfProbe {
  readonly enabled: boolean;
  record(sample: FramePerfSample): void;
  reset(): void;
  snapshot(): FramePerfSnapshot;
}
