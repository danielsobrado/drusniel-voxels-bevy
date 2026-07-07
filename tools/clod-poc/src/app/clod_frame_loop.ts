import { createLongViewFrameDiagnostics } from "../phase0/long_view_frame_diagnostics.js";
import { resolveStreamingOwnership } from "../streaming/streaming_ownership.js";
import { TerrainOwnershipRuntime } from "../stream/terrain_ownership_runtime.js";
import { createRendererOwnershipResidencyFeeds } from "../stream/ownership_residency.js";
import { runTerrainFramePhase } from "./frame_loop/terrain_frame_phase.js";
import { runVegetationFramePhase } from "./frame_loop/vegetation_frame_phase.js";
import { runStatsSyncPhase } from "./frame_loop/stats_sync_phase.js";
import {
  STATS_SYNC_THROTTLE_REASON_CODE,
  StatsSyncThrottle,
  type StatsSyncThrottleDecision,
} from "./frame_loop/stats_sync_throttle.js";
import { runRenderPhase } from "./frame_loop/render_phase.js";
import { createBorderOceanDebugPanel } from "../water/border_ocean_debug_panel.js";
import { createFramePerfPhaseTiming, createFramePerfProbeFromQuery, type FramePerfPhaseTiming } from "./frame_loop/perf_probe.js";
import { createP0DirtyAtlasExercise } from "./frame_loop/p0_dirty_atlas_exercise.js";
import { materialChurnDiagnostics } from "../rendering/material_churn/material_churn_diagnostics.js";
import { aggregateGpuVegetationEarlyRejectCounters } from "../vegetation/gpu_vegetation_early_reject_counters.js";
export type { ClodFrameLoopUiState } from "./frame_loop/ui_state.js";
export type { StatsPresenter } from "./frame_loop/stats_presenter.js";
export type { FrameRenderer } from "./frame_loop/frame_renderer.js";
export type {
  ClodFrameLoopDeps,
  FrameLoopRenderDeps,
  FrameLoopPlayerDeps,
  FrameLoopTerrainDeps,
  FrameLoopVegetationDeps,
  FrameLoopWaterWeatherDeps,
  FrameLoopStatsDeps,
  FrameLoopDiagnosticsDeps,
} from "./frame_loop/frame_loop_deps.js";

import type { ClodFrameLoopDeps } from "./frame_loop/frame_loop_deps.js";

const DEBUG_COUNTER_MIRROR_INTERVAL_MS = 250;

type ExtraPhaseTiming = FramePerfPhaseTiming & Record<string, number>;

function timed<T>(
  enabled: boolean,
  phaseTiming: FramePerfPhaseTiming,
  key: keyof FramePerfPhaseTiming,
  fn: () => T,
): T {
  if (!enabled) return fn();
  const start = performance.now();
  try {
    return fn();
  } finally {
    phaseTiming[key] += performance.now() - start;
  }
}

function addExtraTiming(phaseTiming: FramePerfPhaseTiming, key: string, value: number): void {
  if (!Number.isFinite(value)) return;
  const timings = phaseTiming as ExtraPhaseTiming;
  timings[key] = (timings[key] ?? 0) + value;
}

function syncMaterialChurnCounters(counters: Record<string, number>): void {
  const materialChurnStats = materialChurnDiagnostics.frameStats();
  counters["materialChurn.enabled"] = materialChurnStats.enabled ? 1 : 0;
  counters["materialChurn.newMaterials"] = materialChurnStats.newMaterials;
  counters["materialChurn.materialAssignments"] = materialChurnStats.materialReplacements;
  counters["materialChurn.needsUpdate"] = materialChurnStats.materialNeedsUpdate;
  counters["materialChurn.versionChanges"] = materialChurnStats.materialVersionChanges;
  counters["materialChurn.pipelineSensitiveChanges"] = materialChurnStats.pipelineSensitiveChanges;
  counters["materialChurn.rendererProgramCount"] = materialChurnStats.rendererProgramCount ?? -1;
  counters["materialChurn.rendererProgramDelta"] = materialChurnStats.rendererProgramDelta ?? 0;
  counters["materialChurn.suspectedPipelineKeyChanges"] = materialChurnStats.suspectedPipelineKeyChanges;
}

function statsRelevantModeKey(state: Record<string, unknown>, gpuTimingActive: boolean, perfProbeActive: boolean, benchmarkActive: boolean, acceptanceActive: boolean): string {
  return [
    state["profileEnabled"],
    gpuTimingActive,
    perfProbeActive,
    benchmarkActive,
    acceptanceActive,
    state["clodPerfMode"],
    state["grassEnabled"],
    state["treesEnabled"],
    state["understoryEnabled"],
    state["forestLightingEnabled"],
    state["forestLightingDebugMode"],
    state["treeGpuEnabled"],
    state["treeGpuForceCpu"],
    state["treeGpuShowCounts"],
    state["treeGpuReadbackVisibleLists"],
    state["treeGpuValidateAgainstCpu"],
    state["treeGpuMaxVisible"],
    state["clodShadowOverlayMode"],
    state["clodShadowProxyView"],
  ].join("|");
}

function panelVisible(id: string): boolean {
  const element = document.getElementById(id);
  return element ? !element.hidden : false;
}

function queryFlag(searchParams: URLSearchParams, keys: readonly string[]): boolean {
  return keys.some((key) => searchParams.get(key) === "1" || searchParams.get(key) === "true");
}

function recordStatsSyncThrottleCounters(
  counters: Record<string, number>,
  decision: StatsSyncThrottleDecision,
  diagnostics: ReturnType<StatsSyncThrottle["diagnostics"]>,
): void {
  counters["statsSyncRuns"] = diagnostics.runs;
  counters["statsSyncSkips"] = diagnostics.skips;
  counters["statsSyncSkippedFrames"] = diagnostics.skippedFrames;
  counters["statsSyncThrottleReason"] = STATS_SYNC_THROTTLE_REASON_CODE[decision.reason];
  counters["statsSyncHzEffective"] = diagnostics.effectiveHz;
}

export function bindClodFrameLoop(deps: ClodFrameLoopDeps): void {
  const { render, player, terrain, vegetation, waterWeather, stats, diagnostics, farSummary, floatingOrigin, shadowProxy, clodShadow, canopy, construction, combat, spells } = deps;
  let elapsedSeconds = 0;
  const averageFpsRef = stats.averageFpsRef;
  const fpsSamples: number[] = [];
  let lastFrameAt = performance.now();
  let lastFpsRefreshAt = lastFrameAt;
  let lastDebugCounterMirrorAt = -Infinity;
  const grassProfileFrame = { value: 0 };
  let materialChurnFrame = 0;
  const debugQuery = new URLSearchParams(window.location.search);
  const borderOceanDebugPanel = diagnostics.queryScene === "border-ocean" || debugQuery.get("borderOceanDebug") === "1"
    ? createBorderOceanDebugPanel(document.body)
    : null;

  const updateAverageFps = () => {
    const now = performance.now();
    const dt = now - lastFrameAt;
    lastFrameAt = now;
    if (dt <= 0) return;

    fpsSamples.push(1000 / dt);
    if (fpsSamples.length > 120) fpsSamples.shift();
    averageFpsRef.value = fpsSamples.reduce((sum, fps) => sum + fps, 0) / fpsSamples.length;

    if (now - lastFpsRefreshAt >= 250) {
      lastFpsRefreshAt = now;
      stats.updateInfo();
    }
  };

  let frameStart = 0;
  const perfProbe = createFramePerfProbeFromQuery(debugQuery);
  const p0DirtyAtlasExercise = createP0DirtyAtlasExercise({
    searchParams: debugQuery,
    queryScene: diagnostics.queryScene,
    camera: render.camera,
    controls: player.controls,
    perfProbe,
    getHooks: render.getHooks,
  });
  const statsSyncThrottle = new StatsSyncThrottle(stats.statsSyncThrottleConfig);
  let statsRevision = 0;
  let lastStatsModeKey = "";
  let lastStatsDecision: StatsSyncThrottleDecision = { shouldRun: false, reason: "skipped" };
  const diagnosticsPageSizeM = diagnostics.longViewDiagnosticsCfg.page.chunks_per_page * diagnostics.longViewDiagnosticsCfg.page.chunk_size;
  const diagnosticsChunksPerPage = diagnostics.longViewDiagnosticsCfg.page.chunks_per_page;
  const ownershipRuntime = new TerrainOwnershipRuntime(
    resolveStreamingOwnership({
      streaming: diagnostics.phase0Streaming,
      targetVisibleM: diagnostics.phase0TargetVisibleM,
      targetFutureVisibleM: diagnostics.phase0Config.phase0.target_future_visible_m,
      pageSizeM: diagnosticsPageSizeM,
      streamingScene: diagnostics.queryScene?.startsWith("infinite-") ?? false,
    }),
    {
      live: {
        chunkSizeM: diagnostics.longViewDiagnosticsCfg.page.chunk_size,
        hysteresisM: diagnostics.longViewDiagnosticsCfg.page.chunk_size * 2,
      },
      visualPages: {
        pageSizeM: diagnosticsPageSizeM,
        maxLevel: diagnostics.maxTerrainLevel,
        hysteresisM: diagnosticsPageSizeM,
      },
    },
  );
  const rendererOwnershipResidencyFeeds = () => createRendererOwnershipResidencyFeeds({
    liveReadyPageKeys: () => terrain.nearFieldBubbleController.readyPageKeys(),
    clodReadyPageKeys: () => terrain.getClodReadyPageKeys?.() ?? [],
    liveChunksPerPage: diagnosticsChunksPerPage,
  });
  const updateLongViewDiagnostics = createLongViewFrameDiagnostics({
    getHooks: render.getHooks,
    getAverageFps: () => averageFpsRef.value,
    getFrameStartMs: () => frameStart,
    renderer: render.renderer,
    getSelectionStats: () => terrain.selectionController.stats(),
    maxTerrainLevel: diagnostics.maxTerrainLevel,
    getGrassStats: stats.getGrassStats,
    getTreeStats: stats.getTreeStats,
    getStoneStats: stats.getStoneStats,
    worldCells: terrain.worldCells,
    getFarShellRadiusFactor: diagnostics.getFarShellRadiusFactor,
    farShellBuilt: diagnostics.farShellBuilt,
    farShellCanopyEnabled: diagnostics.farShellCanopyEnabled,
    getFarShellMetrics: diagnostics.getFarShellMetrics,
    infiniteFarShellActive: diagnostics.infiniteFarShellActive,
    isLongView: diagnostics.isLongView,
    getShadowProxyInert: diagnostics.getShadowProxyInert,
    getShadowProxyEnabled: diagnostics.getShadowProxyEnabled,
    phase0TargetVisibleM: diagnostics.phase0TargetVisibleM,
    phase0Config: diagnostics.phase0Config,
    queryScene: diagnostics.queryScene,
    cfg: diagnostics.longViewDiagnosticsCfg,
    camera: render.camera,
    phase0VelocityX: diagnostics.phase0VelocityX,
    phase0VelocityZ: diagnostics.phase0VelocityZ,
    phase0Streaming: diagnostics.phase0Streaming,
    ownershipRuntime,
    getOwnershipResidencyFeeds: rendererOwnershipResidencyFeeds,
    getFarClipmapOwnershipSnapshot: diagnostics.getFarClipmapOwnershipSnapshot,
    borderOceanScene: diagnostics.queryScene === "border-ocean"
      ? {
          waterField: waterWeather.waterField,
          deepOcean: waterWeather.deepOceanConfig,
          deepOceanMeshPresent: waterWeather.deepOceanMeshPresent,
          oceanSampler: waterWeather.oceanSampler,
          playerConfig: player.player.config,
        }
      : undefined,
  });

  render.renderer.setAnimationLoop(() => {
    materialChurnDiagnostics.beginFrame(++materialChurnFrame);
    frameStart = performance.now();
    const collectFrameTiming = player.state.profileEnabled || perfProbe !== null;
    const phaseTiming = createFramePerfPhaseTiming();
    let selectionStats = terrain.selectionController.stats();
    let playerDelta = 0;

    timed(collectFrameTiming, phaseTiming, "frameSetupMs", () => {
      terrain.selectionController.advanceFrame();
      selectionStats = terrain.selectionController.stats();
      player.playerInputController.playerTimer.update();
      playerDelta = Math.min(player.playerInputController.playerTimer.getDelta(), 0.1);
    });
    updateAverageFps();
    p0DirtyAtlasExercise.update(selectionStats.frameId);

    timed(collectFrameTiming, phaseTiming, "inputMs", () => {
      player.controls.update();
    });
    timed(collectFrameTiming, phaseTiming, "constructionMs", () => {
      construction?.update();
    });
    timed(collectFrameTiming, phaseTiming, "combatMs", () => {
      combat?.update(playerDelta);
    });
    timed(collectFrameTiming, phaseTiming, "spellsMs", () => {
      spells?.update(playerDelta);
    });
    timed(collectFrameTiming, phaseTiming, "clodApplyMs", () => {
      terrain.drainClodApplyQueue?.();
    });

    if (collectFrameTiming) {
      const selectionOuterStart = performance.now();
      const updateStart = selectionOuterStart;
      terrain.updateSelection();
      const updateMs = performance.now() - updateStart;
      const statsStart = performance.now();
      selectionStats = terrain.selectionController.stats();
      const statsMs = performance.now() - statsStart;
      const outerMs = performance.now() - selectionOuterStart;
      phaseTiming.selectionUpdateMs += outerMs;
      addExtraTiming(phaseTiming, "selectionOuter.updateCallMs", updateMs);
      addExtraTiming(phaseTiming, "selectionOuter.statsCallMs", statsMs);
      addExtraTiming(phaseTiming, "selectionOuter.wrapperGapMs", Math.max(0, outerMs - updateMs - statsMs));
    } else {
      terrain.updateSelection();
      selectionStats = terrain.selectionController.stats();
    }

    const terrainPhaseResult = timed(collectFrameTiming, phaseTiming, "terrainPhaseMs", () => runTerrainFramePhase({
      state: player.state,
      pageTransitionMode: terrain.pageTransitionMode,
      crossfadeStep: terrain.crossfadeStep,
      interaction: player.interaction,
      player: player.player,
      controls: player.controls,
      selectionController: terrain.selectionController,
      nearFieldBubbleController: terrain.nearFieldBubbleController,
      views: terrain.views,
      worldCells: terrain.worldCells,
      pruneRenderNodeCache: terrain.pruneRenderNodeCache,
    }));

    timed(collectFrameTiming, phaseTiming, "farSummaryMs", () => {
      farSummary?.onFarSummaryUpdate?.(selectionStats.frameId, playerDelta, render.camera);
      floatingOrigin?.controller.rebaseIfNeeded({ camera: render.camera, controls: player.controls, player: player.player, terrainColliders: floatingOrigin.terrainColliders, frameIndex: selectionStats.frameId });
    });
    timed(collectFrameTiming, phaseTiming, "shadowProxyMs", () => {
      shadowProxy?.rebuildIfNeeded();
    });
    timed(collectFrameTiming, phaseTiming, "clodShadowMs", () => {
      clodShadow?.update();
    });
    timed(collectFrameTiming, phaseTiming, "canopyMs", () => {
      canopy?.update(render.camera.position.x, render.camera.position.z);
    });

    elapsedSeconds += playerDelta;
    const vegetationTiming = timed(collectFrameTiming, phaseTiming, "vegetationTotalMs", () => runVegetationFramePhase({
      elapsedSeconds,
      playerDelta,
      ringCenter: terrainPhaseResult.ringCenter,
      grassCenter: terrainPhaseResult.grassCenter,
      camera: render.camera,
      state: player.state,
      grassController: vegetation.grassController,
      treeController: vegetation.treeController,
      understoryController: vegetation.understoryController,
      forestLightingController: vegetation.forestLightingController,
      applyForestLightingToPropMaterials: vegetation.applyForestLightingToPropMaterials,
      stoneController: vegetation.stoneController,
      propController: vegetation.propController,
      waterController: waterWeather.waterController,
      deepOceanSurface: waterWeather.deepOceanSurface,
      deepOceanMaterial: waterWeather.deepOceanMaterial,
      weatherController: waterWeather.weatherController,
      updateWeatherStats: waterWeather.updateWeatherStats,
      weatherStatsController: waterWeather.weatherStatsController,
      currentLighting: vegetation.currentLighting,
      selectionFrameId: selectionStats.frameId,
      worldCells: terrain.worldCells,
      collectTiming: collectFrameTiming,
    }));

    timed(collectFrameTiming, phaseTiming, "borderOceanDebugMs", () => {
      borderOceanDebugPanel?.update({
        worldCells: terrain.worldCells,
        cameraPosition: render.camera.position,
        deepOcean: waterWeather.deepOceanConfig,
        deepOceanMeshPresent: waterWeather.deepOceanMeshPresent,
        oceanSampler: waterWeather.oceanSampler,
        playerConfig: player.player.config,
      });
    });

    const stateRecord = player.state as unknown as Record<string, unknown>;
    const gpuTimingActive = render.gpuPassTiming?.enabled === true;
    const benchmarkActive = stateRecord["clodPerfMode"] === true || queryFlag(debugQuery, ["benchmark", "bench"]);
    const acceptanceActive = queryFlag(debugQuery, ["acceptance", "acceptanceMode", "qa"]);
    const statsModeKey = statsRelevantModeKey(stateRecord, gpuTimingActive, perfProbe !== null, benchmarkActive, acceptanceActive);
    if (statsModeKey !== lastStatsModeKey) {
      lastStatsModeKey = statsModeKey;
      statsRevision += 1;
    }
    const statsPanelVisible = panelVisible("info-panel") || panelVisible("clod-overlay");
    const debugVisible = queryFlag(debugQuery, ["hud", "debugHud", "debugOverlay"]);
    const statsDecision = statsSyncThrottle.shouldRun({
      nowMs: frameStart,
      frameIndex: selectionStats.frameId,
      debugVisible,
      statsPanelVisible,
      profilingActive: player.state.profileEnabled,
      gpuTimingActive,
      perfProbeActive: perfProbe !== null,
      benchmarkActive,
      acceptanceActive,
      forceStatsSync: false,
      statsRevision,
    });
    lastStatsDecision = statsDecision;

    const statsSyncResult = statsDecision.shouldRun
      ? timed(collectFrameTiming, phaseTiming, "statsSyncMs", () => runStatsSyncPhase({
          state: player.state,
          grassSystem: vegetation.grassSystem,
          treeSystem: vegetation.treeSystem,
          stoneSystem: vegetation.stoneSystem,
          understorySystem: vegetation.understorySystem,
          forestLightingSystem: vegetation.forestLightingSystem,
          getGrassStats: stats.getGrassStats,
          setGrassStats: stats.setGrassStats,
          getTreeStats: stats.getTreeStats,
          setTreeStats: stats.setTreeStats,
          getStoneStats: stats.getStoneStats,
          setStoneStats: stats.setStoneStats,
          getUnderstoryStats: stats.getUnderstoryStats,
          setUnderstoryStats: stats.setUnderstoryStats,
          getForestLightingStats: stats.getForestLightingStats,
          setForestLightingStats: stats.setForestLightingStats,
          formatTreeGpuSummary: stats.formatTreeGpuSummary,
          formatUnderstoryGpuSummary: stats.formatUnderstoryGpuSummary,
          statsPresenter: stats.statsPresenter,
        }))
      : {
          currentGrassStats: stats.getGrassStats(),
          currentTreeStats: stats.getTreeStats(),
          currentUnderstoryStats: stats.getUnderstoryStats(),
        };

    const hooks = render.getHooks();
    if (hooks?.stats) recordStatsSyncThrottleCounters(hooks.stats.counters, statsDecision, statsSyncThrottle.diagnostics());

    const mirrorDue = frameStart - lastDebugCounterMirrorAt >= DEBUG_COUNTER_MIRROR_INTERVAL_MS;
    if (mirrorDue) {
      lastDebugCounterMirrorAt = frameStart;
      if (hooks?.stats) {
        const counters = hooks.stats.counters;
        const currentTreeStats = statsSyncResult.currentTreeStats;
        if (currentTreeStats) {
          counters["trees.total"] = currentTreeStats.totalTrees;
          counters["trees.visiblePatches"] = currentTreeStats.visiblePatches;
          counters["trees.patches"] = currentTreeStats.patches;
          counters["trees.visible"] = currentTreeStats.gpuVisibleCount;
          counters["trees.near"] = currentTreeStats.nearTrees;
          counters["trees.mid"] = currentTreeStats.midTrees;
          counters["trees.far"] = currentTreeStats.farTrees;
          counters["trees.impostor"] = currentTreeStats.impostorTrees;
          counters["trees.shadowCasters"] = currentTreeStats.gpuShadowCasterCount;
          counters["trees.candidates"] = currentTreeStats.gpuCandidateCount;
          counters["trees.overflow"] = currentTreeStats.gpuOverflowed ? 1 : 0;
        }
        const aggregateVegetationCounters = aggregateGpuVegetationEarlyRejectCounters({
          treeStats: statsSyncResult.currentTreeStats,
          grassStats: statsSyncResult.currentGrassStats,
          understoryStats: statsSyncResult.currentUnderstoryStats,
        });
        for (const [key, value] of Object.entries(aggregateVegetationCounters)) counters[key] = value;
        const propStats = vegetation.propStats?.current ?? null;
        if (propStats) {
          counters["props.visible"] = propStats.gpuVisibleCount;
          counters["props.candidates"] = propStats.gpuCandidateCount;
        }
        const pageGeometryCacheStats = stats.getPageGeometryCacheStats?.();
        if (pageGeometryCacheStats) {
          counters["pageGeometryCache.enabled"] = pageGeometryCacheStats.enabled ? 1 : 0;
          counters["pageGeometryCache.entries"] = pageGeometryCacheStats.entries;
          counters["pageGeometryCache.hits"] = pageGeometryCacheStats.hits;
          counters["pageGeometryCache.misses"] = pageGeometryCacheStats.misses;
          counters["pageGeometryCache.evictions"] = pageGeometryCacheStats.evictions;
          counters["pageGeometryCache.invalidations"] = pageGeometryCacheStats.invalidations;
          counters["pageGeometryCache.disposals"] = pageGeometryCacheStats.disposals;
          counters["pageGeometryCache.estimatedBytes"] = pageGeometryCacheStats.estimatedBytes;
        }
        const renderNodeCacheStats = stats.getRenderNodeCacheStats?.();
        if (renderNodeCacheStats) {
          counters["renderNodeCache.enabled"] = renderNodeCacheStats.enabled ? 1 : 0;
          counters["renderNodeCache.materializedNodes"] = renderNodeCacheStats.materializedNodes;
          counters["renderNodeCache.activeNodes"] = renderNodeCacheStats.activeNodes;
          counters["renderNodeCache.inactiveNodes"] = renderNodeCacheStats.inactiveNodes;
          counters["renderNodeCache.creates"] = renderNodeCacheStats.creates;
          counters["renderNodeCache.reuses"] = renderNodeCacheStats.reuses;
          counters["renderNodeCache.disposals"] = renderNodeCacheStats.disposals;
          counters["renderNodeCache.evictions"] = renderNodeCacheStats.evictions;
          counters["renderNodeCache.prefetches"] = renderNodeCacheStats.prefetches;
        }
        const clodApplyStats = terrain.getClodApplyStats?.();
        if (clodApplyStats) {
          counters["clodWorkerRebuildMs"] = clodApplyStats.clodWorkerRebuildMs;
          counters["clodApplyTotalMs"] = clodApplyStats.clodApplyTotalMs;
          counters["clodApplyGeometryMs"] = clodApplyStats.clodApplyGeometryMs;
          counters["clodApplyMaterialMs"] = clodApplyStats.clodApplyMaterialMs;
          counters["clodApplyColliderMs"] = clodApplyStats.clodApplyColliderMs;
          counters["clodApplyNodes"] = clodApplyStats.clodApplyNodes;
          counters["clodApplyTriangles"] = clodApplyStats.clodApplyTriangles;
          counters["clodApplyQueueDepth"] = clodApplyStats.clodApplyQueueDepth;
          counters["clodColliderQueueDepth"] = clodApplyStats.clodColliderQueueDepth;
          counters["clodStaleVisibleNodes"] = clodApplyStats.clodStaleVisibleNodes;
          counters["clodApplyBudgetExceeded"] = clodApplyStats.clodApplyBudgetExceeded;
          counters["clodColliderApplyMs"] = clodApplyStats.clodColliderApplyMs;
          counters["clodColliderJobsApplied"] = clodApplyStats.clodColliderJobsApplied;
          counters["clodColliderPriorityOverrides"] = clodApplyStats.clodColliderPriorityOverrides;
          counters["clodColliderStaleFramesMax"] = clodApplyStats.clodColliderStaleFramesMax;
          counters["clodGeometryReusedOnApply"] = clodApplyStats.clodGeometryReusedOnApply;
        }
        if (pageGeometryCacheStats) {
          counters["clodGeometryCacheHits"] = pageGeometryCacheStats.hits;
          counters["clodGeometryCacheMisses"] = pageGeometryCacheStats.misses;
          counters["clodGeometryCacheEvictions"] = pageGeometryCacheStats.evictions;
        }
        syncMaterialChurnCounters(counters);
        const selectionCacheStats = terrain.selectionController.stats().selectionCache;
        counters["selectionCutCache.enabled"] = selectionCacheStats.enabled ? 1 : 0;
        counters["selectionCutCache.hits"] = selectionCacheStats.hits;
        counters["selectionCutCache.misses"] = selectionCacheStats.misses;
        counters["selectionCutCache.invalidations"] = selectionCacheStats.invalidations;
      }
    }

    runRenderPhase({
      renderer: render.renderer,
      scene: render.scene,
      camera: render.camera,
      gpuPasses: render.gpuPassTiming?.passes ?? null,
      postProcess: render.postProcess,
      currentPostProcessSettings: render.currentPostProcessSettings,
      nodeLabelOverlay: render.nodeLabelOverlay,
      selectionController: terrain.selectionController,
      getHooks: render.getHooks,
      longViewSettleWaiters: render.longViewSettleWaiters,
      frameStart,
      profileEnabled: player.state.profileEnabled,
      profileFrameMs: render.profileFrameMs,
      grassProfileEnabled: render.grassProfileEnabled,
      grassProfileFrame,
      currentGrassStats: statsSyncResult.currentGrassStats,
      currentTreeStats: statsSyncResult.currentTreeStats,
      currentUnderstoryStats: statsSyncResult.currentUnderstoryStats,
      currentPropStats: vegetation.propStats?.current ?? null,
      tPropsStart: terrainPhaseResult.tPropsStart,
      tBubbleStart: terrainPhaseResult.tBubbleStart,
      vegetationTiming,
      chunkGroupsBuiltThisFrame: terrainPhaseResult.chunkGroupsBuiltThisFrame,
      nearFieldBubbleController: terrain.nearFieldBubbleController,
      interaction: player.interaction,
      makeGrassSettings: render.makeGrassSettings,
      grassPrepassEnabled: render.grassPrepassEnabled,
      perfProbe,
      phaseTiming,
      dynamicResolution: render.dynamicResolution,
      statsSyncThrottle: {
        decision: lastStatsDecision,
        diagnostics: statsSyncThrottle.diagnostics(),
      },
      afterRenderDiagnostics: () => timed(collectFrameTiming, phaseTiming, "longViewDiagnosticsMs", updateLongViewDiagnostics),
    });

    render.gpuPassTiming?.update();
    if (render.gpuPassTiming?.enabled) {
      if (hooks?.stats) {
        const dst = hooks.stats.gpuPasses;
        for (const key of Object.keys(dst)) delete dst[key];
        Object.assign(dst, render.gpuPassTiming.passes);
      }
    }

    if (hooks?.stats) syncMaterialChurnCounters(hooks.stats.counters);
  });
}
