import { createLongViewFrameDiagnostics } from "../phase0/long_view_frame_diagnostics.js";
import { runTerrainFramePhase } from "./frame_loop/terrain_frame_phase.js";
import { runVegetationFramePhase } from "./frame_loop/vegetation_frame_phase.js";
import { runStatsSyncPhase } from "./frame_loop/stats_sync_phase.js";
import { runRenderPhase } from "./frame_loop/render_phase.js";
import { submitMsChanged } from "./frame_loop/frame_timing.js";
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

export function bindClodFrameLoop(deps: ClodFrameLoopDeps): void {
  const { render, player, terrain, vegetation, waterWeather, stats, diagnostics, farSummary } = deps;
  let elapsedSeconds = 0;
  const averageFpsRef = stats.averageFpsRef;
  const fpsSamples: number[] = [];
  let lastFrameAt = performance.now();
  let lastFpsRefreshAt = lastFrameAt;
  let grassProfileFrame = { value: 0 };

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
    isLongView: diagnostics.isLongView,
    phase0TargetVisibleM: diagnostics.phase0TargetVisibleM,
    phase0Config: diagnostics.phase0Config,
    queryScene: diagnostics.queryScene,
    cfg: diagnostics.longViewDiagnosticsCfg,
    camera: render.camera,
    phase0VelocityX: diagnostics.phase0VelocityX,
    phase0VelocityZ: diagnostics.phase0VelocityZ,
    phase0Streaming: diagnostics.phase0Streaming,
  });

  render.renderer.setAnimationLoop(() => {
    frameStart = performance.now();
    terrain.selectionController.advanceFrame();
    const selectionStats = terrain.selectionController.stats();
    player.playerInputController.playerTimer.update();
    const playerDelta = Math.min(player.playerInputController.playerTimer.getDelta(), 0.1);
    if (vegetation.propController) {
      const p = player.player.position;
      vegetation.propController.syncColliders([p.x, p.y, p.z]);
    }
    elapsedSeconds += playerDelta;
    updateAverageFps();
    player.playerInputController.updateFrame(playerDelta);
    render.skyEnvironment?.updateCamera(render.camera);
    vegetation.drainVegetationDirtyQueue();
    vegetation.treeController.updateFallingTrees(playerDelta);
    if (!player.state.freeze) terrain.updateSelection();

    updateLongViewDiagnostics();

    farSummary?.onFarSummaryUpdate?.(selectionStats.frameId, playerDelta, render.camera);

    player.playerInputController.updateHoldToDig();

    player.brushPreview.update({
      digEnabled: player.state.digEnabled,
      interactionMode: player.interaction.mode,
      terraformEditActive: player.playerTerraformEditActive(),
      brushShape: player.state.brushShape,
      brushOp: player.state.brushOp,
      digRadius: player.state.digRadius,
      brushHeight: player.state.brushHeight,
      raycastEditableTerrain: player.terrainRaycast.raycastEditableTerrain,
      getPlayingAimRay: () => player.playerInputController.getPlayingAimRay(),
      getOrbitHoverRay: () => player.playerInputController.getOrbitHoverRay(),
    });

    const terrainPhase = runTerrainFramePhase({
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
    });

    runVegetationFramePhase({
      elapsedSeconds,
      playerDelta,
      ringCenter: terrainPhase.ringCenter,
      grassCenter: terrainPhase.grassCenter,
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
      deepOceanMaterial: waterWeather.deepOceanMaterial,
      weatherController: waterWeather.weatherController,
      updateWeatherStats: waterWeather.updateWeatherStats,
      weatherStatsController: waterWeather.weatherStatsController,
      currentLighting: vegetation.currentLighting,
      selectionFrameId: selectionStats.frameId,
      worldCells: terrain.worldCells,
    });

    const { currentGrassStats } = runStatsSyncPhase({
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
    });

    runRenderPhase({
      renderer: render.renderer,
      scene: render.scene,
      camera: render.camera,
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
      currentGrassStats,
      tPropsStart: terrainPhase.tPropsStart,
      tBubbleStart: terrainPhase.tBubbleStart,
      chunkGroupsBuiltThisFrame: terrainPhase.chunkGroupsBuiltThisFrame,
      nearFieldBubbleController: terrain.nearFieldBubbleController,
      interaction: player.interaction,
      makeGrassSettings: render.makeGrassSettings,
      grassPrepassEnabled: render.grassPrepassEnabled,
    });
  });
}

export { submitMsChanged };
