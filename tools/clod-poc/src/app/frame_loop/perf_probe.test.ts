import { describe, expect, it } from "vitest";
import {
  createFramePerfProbeFromQuery,
  createFramePerfPhaseTiming,
  summarizeFramePerfSamples,
  type FramePerfSample,
} from "./perf_probe.js";

function sample(overrides: Partial<FramePerfSample> = {}): FramePerfSample {
  return {
    frameId: 1,
    frameMs: 16,
    selectionMs: 1,
    bubbleMs: 0,
    propsMs: 3,
    otherMs: 1,
    frameSetupMs: 1,
    inputMs: 0.5,
    selectionUpdateMs: 1,
    clodApplyMs: 0,
    longViewDiagnosticsMs: 0,
    farSummaryMs: 0,
    farSumTilesMs: 0,
    farSumNaadfMs: 0,
    farSumShellMs: 0,
    farSumClipmapMs: 0,
    farSumShellMoveMs: 0,
    farSumShadowProxyMs: 0,
    farSumBiomeStreamMs: 0,
    farSumSunLightMs: 0,
    farSumStatsDomMs: 0,
    constructionMs: 0,
    brushMs: 0,
    combatMs: 0,
    spellsMs: 0,
    agentEnvelopeMs: 0,
    terrainPhaseMs: 1,
    shadowProxyMs: 0,
    clodShadowMs: 0,
    canopyMs: 0,
    vegetationTotalMs: 2,
    borderOceanDebugMs: 0,
    statsSyncMs: 0,
    renderMs: 10,
    unattributedMs: 1,
    selectionCutMs: 0.2,
    selectionBookMs: 0.3,
    selectionInfoMs: 0.4,
    selectionOverlaysMs: 0.1,
    "selectionSub.settings": 0.01,
    "selectionSub.params": 0.02,
    "selectionSub.compute": 0.03,
    "selectionSub.readback": 0.04,
    "selectionSub.parity": 0.05,
    "selectionSub.lookup": 0.06,
    "selectionSub.cache": 0.07,
    "selectionSub.cut": 0.2,
    "selectionSub.book": 0.3,
    "selectionSub.views": 0.04,
    "selectionSub.markActive": 0.08,
    "selectionSub.prefetch": 0.05,
    "selectionSub.apply": 0.09,
    "selectionSub.stats": 0.1,
    "selectionSub.hash": 0.11,
    "selectionSub.commit": 0.12,
    "selectionSub.info": 0.4,
    "selectionSub.overlays": 0.1,
    "selectionSub.dispatch": 0.13,
    "selectionSub.total": 1,
    selectionCutCacheEnabled: 1,
    selectionCutCacheHits: 1,
    selectionCutCacheMisses: 0,
    selectionCutCacheInvalidations: 0,
    selectionCutCacheLastReason: "hit",
    selectionCutCacheLastReasonCode: 0,
    cachedFastHits: 1,
    grassMs: 0.5,
    treesMs: 0.5,
    understoryMs: 0,
    forestLightingMs: 0,
    stonesMs: 0,
    customPropsMs: 0,
    waterMs: 1,
    deepOceanMs: 0,
    weatherMs: 0,
    propsRestMs: 1,
    propsUnattributedMs: 0,
    materialChurnNewMaterials: 0,
    materialChurnAssignments: 0,
    materialChurnNeedsUpdate: 0,
    materialChurnVersionChanges: 0,
    materialChurnPipelineSensitiveChanges: 0,
    materialChurnRendererProgramCount: 0,
    materialChurnRendererProgramDelta: 0,
    materialChurnSuspectedPipelineKeyChanges: 0,
    renderedCount: 4,
    terrainTriangles: 12000,
    chunkGroupsBuilt: 0,
    nearFieldChunkGroups: 0,
    interactionMode: "orbit",
    treeGpuStatus: "ring",
    treeTotalTrees: 100,
    treeVisiblePatches: 3,
    treePatches: 4,
    treeNearTrees: 10,
    treeMidTrees: 20,
    treeFarTrees: 30,
    treeImpostorTrees: 40,
    treeHeroNearTriangles: 130_000,
    treeHeroNearFoliageTriangles: 92_000,
    treeHeroNearMinTreeTriangles: 8_000,
    treeHeroNearAvgTreeTriangles: 13_000,
    treeHeroNearPassesTriangleFloor: 1,
    treeHeroNearPassesRealFoliage: 1,
    treeGpuCandidateCount: 96,
    treeGpuCandidateCountBeforePrefilter: 120,
    treeGpuCandidateCountAfterPrefilter: 96,
    treeGpuPrefilterRejectedClusters: 2,
    treeGpuPrefilterSkippedCandidateEstimate: 24,
    treeGpuPrefilterFarSummaryConsulted: 11,
    treeGpuPrefilterSourceFarSummary: 8,
    treeGpuPrefilterSourceTerrainSampler: 4,
    treeGpuPrefilterSourceFallback: 2,
    treeGpuAcceptedCount: 100,
    treeGpuVisibleCount: 80,
    treeGpuShadowCasterCount: 64,
    treeGpuShadowOverflowed: 0,
    treeGpuDispatchMs: 0.2,
    treeVisibleClusterHidden: 2,
    treeVisibleClusterVisible: 14,
    treeVisibleClusterUnknownKept: 1,
    grassGpuCandidateCount: 256,
    grassGpuCandidateCountBeforePrefilter: 512,
    grassGpuCandidateCountAfterPrefilter: 256,
    grassGpuPrefilterFarSummaryConsulted: 10,
    grassGpuPrefilterSourceFarSummary: 7,
    grassGpuPrefilterSourceTerrainSampler: 5,
    grassGpuPrefilterSourceFallback: 3,
    grassGpuAcceptedCount: 128,
    grassGpuVisibleCount: 96,
    understoryGpuCandidateCount: 128,
    understoryGpuCandidateCountBeforePrefilter: 256,
    understoryGpuCandidateCountAfterPrefilter: 128,
    understoryGpuPrefilterFarSummaryConsulted: 9,
    understoryGpuPrefilterSourceFarSummary: 6,
    understoryGpuPrefilterSourceTerrainSampler: 4,
    understoryGpuPrefilterSourceFallback: 2,
    understoryGpuAcceptedCount: 64,
    understoryGpuVisibleCount: 48,
    customPropGpuStatus: "ring",
    customPropTotalInstances: 50,
    customPropVisibleInstances: 30,
    customPropGpuCandidateCount: 45,
    customPropGpuVisibleCount: 30,
    customPropGpuOverflowed: 0,
    customPropGpuDispatchMs: 0.1,
    dynamicResolutionActive: 0,
    dynamicResolutionRenderScale: 1,
    dynamicResolutionAdjustments: 0,
    statsSyncRan: 0,
    statsSyncRuns: 0,
    statsSyncSkips: 0,
    statsSyncThrottleReason: "skipped",
    statsSyncHzEffective: 0,
    ...overrides,
  };
}

describe("frame perf probe", () => {
  it("retains the full 1,320-frame long-route window", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __drusnielClod: { stats: { counters: {} } } },
    });
    const probe = createFramePerfProbeFromQuery(new URLSearchParams({ perfProbe: "1" }));

    for (let frameId = 1; frameId <= 1_320; frameId++) probe?.record(sample({ frameId }));

    expect(window.__drusnielPerf?.recentSamples).toHaveLength(1_320);
    expect(window.__drusnielPerf?.recentSamples[0]?.frameId).toBe(1);
  });

  it("mirrors every far-summary subphase for headless diagnostics", () => {
    const counters: Record<string, number> = {};
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { __drusnielClod: { stats: { counters } } },
    });
    const probe = createFramePerfProbeFromQuery(new URLSearchParams({
      perfProbe: "1",
      perfWarmupFrames: "0",
      perfSampleFrames: "1",
    }));

    probe?.record(sample({
      farSummaryMs: 9,
      farSumTilesMs: 1,
      farSumNaadfMs: 2,
      farSumShellMs: 3,
      farSumClipmapMs: 4,
      farSumShellMoveMs: 5,
      farSumShadowProxyMs: 6,
      farSumBiomeStreamMs: 7,
      farSumSunLightMs: 8,
      farSumStatsDomMs: 9,
    }));

    expect(counters["framePerf.p95.farSumTilesMs"]).toBe(1);
    expect(counters["framePerf.p95.farSumNaadfMs"]).toBe(2);
    expect(counters["framePerf.p95.farSumShellMs"]).toBe(3);
    expect(counters["framePerf.p95.farSumClipmapMs"]).toBe(4);
    expect(counters["framePerf.p95.farSumShellMoveMs"]).toBe(5);
    expect(counters["framePerf.p95.farSumShadowProxyMs"]).toBe(6);
    expect(counters["framePerf.p95.farSumBiomeStreamMs"]).toBe(7);
    expect(counters["framePerf.p95.farSumSunLightMs"]).toBe(8);
    expect(counters["framePerf.p95.farSumStatsDomMs"]).toBe(9);
  });

  it("zeros every frame-loop phase bucket", () => {
    expect(createFramePerfPhaseTiming()).toEqual({
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
    });
  });

  it("ranks detailed phase and prop buckets by p95", () => {
    const summary = summarizeFramePerfSamples([
      sample({ renderMs: 9, frameMs: 16, propsUnattributedMs: 1, treeHeroNearMinTreeTriangles: 9_000, treeGpuShadowCasterCount: 60, treeVisibleClusterHidden: 2, treeVisibleClusterVisible: 14, treeVisibleClusterUnknownKept: 1 }),
      sample({ renderMs: 24, frameMs: 32, statsSyncMs: 4, propsUnattributedMs: 7, selectionCutCacheMisses: 1, selectionCutCacheLastReason: "camera_bucket_changed", selectionCutCacheLastReasonCode: 3, cachedFastHits: 1, "selectionSub.readback": 0.8, "selectionSub.total": 1.5, treeHeroNearTriangles: 150_000, treeHeroNearMinTreeTriangles: 7_000, treeGpuCandidateCountBeforePrefilter: 160, treeGpuCandidateCountAfterPrefilter: 100, treeGpuPrefilterRejectedClusters: 6, treeGpuPrefilterSkippedCandidateEstimate: 60, treeGpuPrefilterFarSummaryConsulted: 13, treeGpuPrefilterSourceFarSummary: 10, treeGpuPrefilterSourceTerrainSampler: 6, treeGpuPrefilterSourceFallback: 4, treeGpuShadowCasterCount: 68, treeGpuShadowOverflowed: 1, treeVisibleClusterHidden: 6, treeVisibleClusterVisible: 10, treeVisibleClusterUnknownKept: 3, grassGpuCandidateCountBeforePrefilter: 640, grassGpuCandidateCountAfterPrefilter: 320, grassGpuPrefilterFarSummaryConsulted: 12, grassGpuPrefilterSourceFarSummary: 9, grassGpuPrefilterSourceTerrainSampler: 7, grassGpuPrefilterSourceFallback: 5, understoryGpuCandidateCountBeforePrefilter: 384, understoryGpuCandidateCountAfterPrefilter: 192, understoryGpuPrefilterFarSummaryConsulted: 11, understoryGpuPrefilterSourceFarSummary: 8, understoryGpuPrefilterSourceTerrainSampler: 6, understoryGpuPrefilterSourceFallback: 4, statsSyncRan: 1, statsSyncRuns: 1, statsSyncSkips: 1, statsSyncThrottleReason: "normal", statsSyncHzEffective: 4 }),
    ], 10, 2);

    expect(summary.sampleCount).toBe(2);
    expect(summary.metrics.frameMs.p95).toBe(32);
    expect(summary.metrics["selectionSub.cut"].p95).toBe(0.2);
    expect(summary.metrics["selectionSub.readback"].p95).toBe(0.8);
    expect(summary.metrics["selectionSub.total"].p95).toBe(1.5);
    expect(summary.broadBucketsByP95[0]).toMatchObject({ name: "renderMs", p95: 24 });
    expect(summary.propBucketsByP95[0]).toMatchObject({ name: "propsUnattributedMs", p95: 7 });
    expect(summary.counters.terrainTrianglesAvg).toBe(12000);
    expect(summary.counters.selectionCutCacheHitsMax).toBe(1);
    expect(summary.counters.selectionCutCacheMissesMax).toBe(1);
    expect(summary.counters.selectionCutCacheLastReasonCode).toBe(3);
    expect(summary.counters.selectionCutCacheReasonCounts).toEqual({ hit: 1, camera_bucket_changed: 1 });
    expect(summary.counters.cachedFastHitsMax).toBe(1);
    expect(summary.counters.treeGpuStatusCounts).toEqual({ ring: 2 });
    expect(summary.counters.treeGpuCandidateCountAvg).toBe(96);
    expect(summary.counters.treeGpuCandidateCountBeforePrefilterAvg).toBe(140);
    expect(summary.counters.treeGpuCandidateCountAfterPrefilterAvg).toBe(98);
    expect(summary.counters.treeGpuPrefilterRejectedClustersAvg).toBe(4);
    expect(summary.counters.treeGpuPrefilterSkippedCandidateEstimateAvg).toBe(42);
    expect(summary.counters.treeGpuPrefilterFarSummaryConsultedAvg).toBe(12);
    expect(summary.counters.treeGpuPrefilterSourceFarSummaryAvg).toBe(9);
    expect(summary.counters.treeGpuPrefilterSourceTerrainSamplerAvg).toBe(5);
    expect(summary.counters.treeGpuPrefilterSourceFallbackAvg).toBe(3);
    expect(summary.counters.treeGpuVisibleCountAvg).toBe(80);
    expect(summary.counters.treeGpuShadowCasterCountAvg).toBe(64);
    expect(summary.counters.treeGpuShadowOverflowedFrames).toBe(1);
    expect(summary.counters.treeVisibleClusterHiddenAvg).toBe(4);
    expect(summary.counters.treeVisibleClusterVisibleAvg).toBe(12);
    expect(summary.counters.treeVisibleClusterUnknownKeptAvg).toBe(2);
    expect(summary.counters.treeHeroNearTrianglesAvg).toBe(140_000);
    expect(summary.counters.treeHeroNearFoliageTrianglesAvg).toBe(92_000);
    expect(summary.counters.treeHeroNearMinTreeTrianglesMin).toBe(7_000);
    expect(summary.counters.treeHeroNearPassesTriangleFloorFrames).toBe(2);
    expect(summary.counters.treeHeroNearPassesRealFoliageFrames).toBe(2);
    expect(summary.counters.grassGpuCandidateCountAvg).toBe(256);
    expect(summary.counters.grassGpuCandidateCountBeforePrefilterAvg).toBe(576);
    expect(summary.counters.grassGpuCandidateCountAfterPrefilterAvg).toBe(288);
    expect(summary.counters.grassGpuPrefilterFarSummaryConsultedAvg).toBe(11);
    expect(summary.counters.grassGpuPrefilterSourceFarSummaryAvg).toBe(8);
    expect(summary.counters.grassGpuPrefilterSourceTerrainSamplerAvg).toBe(6);
    expect(summary.counters.grassGpuPrefilterSourceFallbackAvg).toBe(4);
    expect(summary.counters.understoryGpuCandidateCountAvg).toBe(128);
    expect(summary.counters.understoryGpuCandidateCountBeforePrefilterAvg).toBe(320);
    expect(summary.counters.understoryGpuCandidateCountAfterPrefilterAvg).toBe(160);
    expect(summary.counters.understoryGpuPrefilterFarSummaryConsultedAvg).toBe(10);
    expect(summary.counters.understoryGpuPrefilterSourceFarSummaryAvg).toBe(7);
    expect(summary.counters.understoryGpuPrefilterSourceTerrainSamplerAvg).toBe(5);
    expect(summary.counters.understoryGpuPrefilterSourceFallbackAvg).toBe(3);
    expect(summary.counters.vegetationGpuClustersTotalAvg).toBe(18);
    expect(summary.counters.vegetationGpuClustersRejectedEarlyAvg).toBe(4);
    expect(summary.counters.vegetationGpuClustersAcceptedAvg).toBe(10);
    expect(summary.counters.vegetationGpuClustersSummaryMissingAvg).toBe(2);
    expect(summary.counters.vegetationGpuFarSummaryConsultedAvg).toBe(33);
    expect(summary.counters.vegetationGpuSourceFarSummaryAvg).toBe(24);
    expect(summary.counters.vegetationGpuSourceTerrainSamplerAvg).toBe(16);
    expect(summary.counters.vegetationGpuSourceFallbackAvg).toBe(10);
    expect(summary.counters.vegetationGpuCandidatesBudgetBeforeRejectAvg).toBe(1036);
    expect(summary.counters.vegetationGpuCandidatesBudgetAfterRejectAvg).toBe(546);
    expect(summary.counters.vegetationGpuCandidatesGeneratedAvg).toBe(480);
    expect(summary.counters.vegetationGpuRejectTerrainHiddenAvg).toBe(4);
    expect(summary.counters.customPropGpuStatusCounts).toEqual({ ring: 2 });
    expect(summary.counters.customPropGpuVisibleCountAvg).toBe(30);
    expect(summary.counters.statsSyncRanFrames).toBe(1);
    expect(summary.counters.statsSyncRuns).toBe(1);
    expect(summary.counters.statsSyncSkips).toBe(1);
    expect(summary.counters.statsSyncThrottleReasonCounts).toEqual({ skipped: 1, normal: 1 });
    expect(summary.counters.statsSyncHzEffectiveAvg).toBe(2);
  });
});
