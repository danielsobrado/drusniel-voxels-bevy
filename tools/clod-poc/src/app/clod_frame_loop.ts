import { createLongViewFrameDiagnostics } from "../phase0/long_view_frame_diagnostics.js";
import { runTerrainFramePhase } from "./frame_loop/terrain_frame_phase.js";
import { runVegetationFramePhase } from "./frame_loop/vegetation_frame_phase.js";
import { runStatsSyncPhase } from "./frame_loop/stats_sync_phase.js";
import { runRenderPhase } from "./frame_loop/render_phase.js";
import { submitMsChanged } from "./frame_loop/frame_timing.js";
import { createBorderOceanDebugPanel } from "../water/border_ocean_debug_panel.js";
import { createFramePerfPhaseTiming, createFramePerfProbeFromQuery, type FramePerfPhaseTiming } from "./frame_loop/perf_probe.js";
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

export function bindClodFrameLoop(deps: ClodFrameLoopDeps): void {
  const { render, player, terrain, vegetation, waterWeather, stats, diagnostics, farSummary, floatingOrigin, shadowProxy, clodShadow, canopy, construction, combat, spells } = deps;
  let elapsedSeconds = 0;
  const averageFpsRef = stats.averageFpsRef;
  const fpsSamples: number[] = [];
  let lastFrameAt = performance.now();
  let lastFpsRefreshAt = lastFrameAt;
  let grassProfileFrame = { value: 0 };
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
      if (vegetation.propController) {
        vegetation.propController.updateDynamicPlacements();
      }
      if (terrain.updateFloatingOriginForView) {
        terrain.updateFloatingOriginForView();
      }
    });
    updateAverageFps();

    timed(collectFrameTiming, phaseTiming, "inputMs", () => {
      player.controls.update();
      if (construction.constructionController) construction.constructionController.update(player.playerInputController.keys);
      if (combat.combatController) combat.combatController.update(playerDelta);
      if (spells.spellController) spells.spellController.update(playerDelta);
    });

    timed(collectFrameTiming, phaseTiming, "selectionMs", () => {
      terrain.updateSelection();
      selectionStats = terrain.selectionController.stats();
    });

    const terrainPhaseResult = timed(collectFrameTiming, phaseTiming, "terrainPhaseMs", () => runTerrainFramePhase({
      state: terrain.state,
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

    if (waterWeather.weatherController) {
      timed(collectFrameTiming, phaseTiming, "weatherMs", () => waterWeather.weatherController.update(playerDelta));
    }

    timed(collectFrameTiming, phaseTiming, "farSummaryMs", () => {
      farSummary.update();
      floatingOrigin.update();
      shadowProxy.update();
      clodShadow.update();
      canopy.update();
    });

    const vegetationResult = timed(collectFrameTiming, phaseTiming, "vegetationTotalMs", () => runVegetationFramePhase({
      state: terrain.state,
      player: player.player,
      controls: player.controls,
      interaction: player.interaction,
      queryScene: diagnostics.queryScene,
      queryCanopy: diagnostics.queryCanopy,
      ringCenter: terrainPhaseResult.ringCenter,
      grassCenter: terrainPhaseResult.grassCenter,
      grassProfileFrame,
      vegetation,
      worldCells: terrain.worldCells,
    }));
    const currentTreeStats = vegetationResult.currentTreeStats;

    timed(collectFrameTiming, phaseTiming, "statsSyncMs", () => runStatsSyncPhase({
      state: terrain.state,
      player: player.player,
      renderer: render.renderer,
      selectionStats,
      vegetationResult,
      terrainStats: {
        chunkGroupsBuiltThisFrame: terrainPhaseResult.chunkGroupsBuiltThisFrame,
      },
      weatherStats: waterWeather.updateWeatherStats(),
      frameTiming: collectFrameTiming ? phaseTiming : null,
      stats: {
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
      },
    }));

    // TP-1: resolve the previous frame's GPU timestamps and mirror the
    // per-pass ms into the long-view stats hook when present.
    render.gpuPassTiming?.update();
    if (render.gpuPassTiming?.enabled) {
      const hooks = render.getHooks();
      if (hooks?.stats) {
        const dst = hooks.stats.gpuPasses;
        for (const key of Object.keys(dst)) delete dst[key];
        Object.assign(dst, render.gpuPassTiming.passes);
      }
    }

    // Mirror GPU-driven scatter culling counts into the HUD counters. The
    // renderer's `info.render.triangles` reports fixed indirect-draw capacity,
    // not what the GPU frustum cull actually kept, so these are the only live
    // signal that culling responds to the camera. `trees.visible` / per-LOD
    // stay 0 unless the GPU count readback is enabled
    // (trees.gpu.readback_visible_lists + debug_show_gpu_counts); the readback
    // is a GPU->CPU stall so it is opt-in.
    {
      const hooks = render.getHooks();
      if (hooks?.stats) {
        const counters = hooks.stats.counters;
        counters["selectionCache.hits"] = selectionStats.cache.hits;
        counters["selectionCache.misses"] = selectionStats.cache.misses;
        counters["selectionCache.lastHit"] = selectionStats.cache.lastHit ? 1 : 0;
        if (currentTreeStats) {
          // CPU patch path (trees.gpu.enabled=false): three.js frustum-culls
          // whole patches, so visible<patches when the camera looks away.
          counters["trees.total"] = currentTreeStats.totalTrees;
          counters["trees.visiblePatches"] = currentTreeStats.visiblePatches;
          counters["trees.patches"] = currentTreeStats.patches;
          // GPU ring path (trees.gpu.enabled=true): readback-derived counts.
          counters["trees.visible"] = currentTreeStats.gpuVisibleCount;
          counters["trees.near"] = currentTreeStats.nearTrees;
          counters["trees.mid"] = currentTreeStats.midTrees;
          counters["trees.far"] = currentTreeStats.farTrees;
          counters["trees.impostor"] = currentTreeStats.impostorTrees;
          counters["trees.shadowCasters"] = currentTreeStats.gpuShadowCasterCount;
          counters["trees.candidates"] = currentTreeStats.gpuCandidateCount;
          counters["trees.overflow"] = currentTreeStats.gpuOverflowed ? 1 : 0;
        }
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
      borderOceanDebugPanel,
    });
    if (collectFrameTiming && perfProbe) perfProbe.record(phaseTiming);
    updateLongViewDiagnostics();
  });
}
