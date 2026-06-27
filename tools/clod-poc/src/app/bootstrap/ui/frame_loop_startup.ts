import type { GrassStats } from "../../../grass.js";
import type { StoneStats } from "../../../stones/stone_instances.js";
import type { TreeStats } from "../../../trees/index.js";
import type { UnderstoryStats } from "../../../understory/index.js";
import type { ForestLightingStats } from "../../../forest_lighting/index.js";
import { bindClodFrameLoop } from "../../clod_frame_loop.js";
import { resolveSlowFrameMsThreshold } from "../../runtime_config.js";
import { shadowProxyStatsToCounters } from "../../../shadows/shadowProxyStats.js";
import type { StatsPresenter } from "../../frame_loop/stats_presenter.js";
import type { InfoPanelController } from "../info_panel_startup.js";
import type { TerrainEditStartupResult } from "./terrain_edit_startup.js";
import type { UiStartupContext } from "../ui_startup_context.js";

export type { StatsPresenter } from "../../frame_loop/stats_presenter.js";

function statsPresenterFromSession(ctx: UiStartupContext): StatsPresenter {
  const { session, input } = ctx;
  const { statControllers } = input;
  return {
    grassBladeCountController: session.grassBladeCountController,
    grassVisiblePatchesController: session.grassVisiblePatchesController,
    grassTierSummaryController: session.grassTierSummaryController,
    grassEdgeSuppressedController: session.grassEdgeSuppressedController,
    grassCandidateCountController: session.grassCandidateCountController,
    treeTotalController: statControllers.treeTotal,
    treeVisiblePatchesController: statControllers.treeVisiblePatches,
    treeLodSummaryController: statControllers.treeLodSummary,
    treeGpuSummaryController: statControllers.treeGpuSummary,
    stoneTotalController: statControllers.stoneTotal,
    stoneClassSummaryController: statControllers.stoneClassSummary,
    stoneVisibleController: statControllers.stoneVisible,
    understoryTotalController: statControllers.understoryTotal,
    understoryVisiblePatchesController: statControllers.understoryVisiblePatches,
    understoryClassSummaryController: statControllers.understoryClassSummary,
    understoryGpuSummaryController: statControllers.understoryGpuSummary,
    forestLightingStatsController: statControllers.forestLightingStats,
  };
}

export function runFrameLoopStartup(
  ctx: UiStartupContext,
  infoPanel: InfoPanelController,
  terrainEdit: TerrainEditStartupResult,
): void {
  const { input, session } = ctx;
  const {
    searchParams,
    clodRuntime,
    cfg,
    state,
    renderer,
    scene,
    camera,
    controls,
    player,
    interaction,
    terrainRaycast,
    worldCells,
    maxTerrainLevel,
    longView,
  } = input;
  const {
    postProcess,
    skyEnvironment,
    currentPostProcessSettings,
    currentLighting,
    selectionController,
    updateSelection,
    pageTransitionMode,
    crossfadeStep,
    nearFieldBubbleController,
    nodeLabelOverlay,
    views,
    farShellController,
  } = input.terrainView;
  const {
    shadowProxyController,
    shadowProxyDebugState,
    getShadowProxyConfig,
  } = input.terrainView;

  const readShadowProxyCounters = () => {
    if (!shadowProxyController || !shadowProxyDebugState) {
      return { shadow_proxy_enabled: 0, shadow_proxy_inert: 1 };
    }
    const proxyConfig = getShadowProxyConfig();
    return shadowProxyStatsToCounters({
      proxyEnabled: shadowProxyDebugState.shadowProxyEnabled,
      sunShadowsEnabled: shadowProxyDebugState.sunShadowsEnabled,
      stats: shadowProxyController.runtime.stats,
      lightShadowMapSize: shadowProxyDebugState.lightShadowMapSize,
      lightShadowCameraExtentM: proxyConfig.lightShadowCameraExtentM,
    });
  };
  const {
    drainVegetationDirtyQueue,
    treeController,
    grassController,
    understoryController,
    forestLightingController,
    applyForestLightingToPropMaterials,
    stoneController,
    waterController,
    deepOceanMaterial,
    deepOceanSurface,
    waterField,
    deepOceanConfig,
    oceanSampler,
    weatherController,
    updateWeatherStats,
    grassSystem,
    treeSystem,
    understorySystem,
    forestLightingSystem,
    stoneSystem,
    makeGrassSettings,
    formatTreeGpuSummary,
    formatUnderstoryGpuSummary,
    grassStats,
    treeStats,
    stoneStats,
    understoryStats,
    forestLightingStats,
    customProps,
    constructionController,
  } = input.runtime;
  const deepOceanMeshPresent = deepOceanSurface !== null;
  const { updateInfo } = infoPanel;
  const { playerTerraformEditActive } = terrainEdit;
  const statsPresenter = statsPresenterFromSession(ctx);

  if (!session.playerInputController) {
    throw new Error("Frame loop startup requires playerInputController");
  }

  if (customProps?.propController) {
    player.attachPropColliders(customProps.propController.colliderSet);
  }

  constructionController?.setTerrainConformHandler((request) => {
    terrainEdit.scheduleConstructionTerrainConform(request);
  });

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    postProcess?.setSize(window.innerWidth, window.innerHeight);
  });

  const grassProfileEnabled = searchParams.get("grassProfile") === "1";
  const grassPrepassEnabled = searchParams.get("prepass") !== "0";
  const profileFrameMs = resolveSlowFrameMsThreshold(searchParams, clodRuntime.profiling.slowFrameMs);

  bindClodFrameLoop({
    render: {
      renderer,
      scene,
      camera,
      postProcess,
      currentPostProcessSettings,
      nodeLabelOverlay,
      skyEnvironment,
      getHooks: () => longView.hooks,
      longViewSettleWaiters: longView.settleWaiters,
      profileFrameMs,
      grassProfileEnabled,
      grassPrepassEnabled,
      makeGrassSettings,
    },
    player: {
      controls,
      player: player,
      interaction,
      state,
      playerInputController: session.playerInputController,
      playerTerraformEditActive,
      brushPreview: input.terrainView.brushPreview,
      terrainRaycast,
    },
    terrain: {
      selectionController,
      updateSelection,
      pageTransitionMode,
      crossfadeStep,
      nearFieldBubbleController,
      views,
      worldCells,
    },
    vegetation: {
      drainVegetationDirtyQueue,
      treeController,
      grassController,
      understoryController,
      forestLightingController,
      applyForestLightingToPropMaterials,
      stoneController,
      propController: customProps?.propController ?? null,
      grassSystem,
      treeSystem,
      understorySystem,
      forestLightingSystem,
      stoneSystem,
      currentLighting,
    },
    waterWeather: {
      waterController,
      deepOceanSurface,
      deepOceanMaterial,
      waterField,
      deepOceanConfig,
      deepOceanMeshPresent,
      oceanSampler,
      weatherController,
      updateWeatherStats,
      weatherStatsController: session.weatherStatsController,
    },
    stats: {
      getGrassStats: () => grassStats.current,
      setGrassStats: (stats: GrassStats | null) => { grassStats.current = stats; },
      getTreeStats: () => treeStats.current,
      setTreeStats: (stats: TreeStats | null) => { treeStats.current = stats; },
      getStoneStats: () => stoneStats.current,
      setStoneStats: (stats: StoneStats | null) => { stoneStats.current = stats; },
      getUnderstoryStats: () => understoryStats.current,
      setUnderstoryStats: (stats: UnderstoryStats | null) => { understoryStats.current = stats; },
      getForestLightingStats: () => forestLightingStats.current,
      setForestLightingStats: (stats: ForestLightingStats | null) => { forestLightingStats.current = stats; },
      formatTreeGpuSummary,
      formatUnderstoryGpuSummary,
      statsPresenter,
      updateInfo,
      averageFpsRef: session.averageFpsRef,
    },
    diagnostics: {
      maxTerrainLevel,
      farShellBuilt: () => farShellController.isBuilt(),
      farShellCanopyEnabled: () =>
        farShellController.canopyShell !== null || input.terrainView.canopyShellSystem !== null,
      getFarShellMetrics: () => longView.farShellMetrics,
      infiniteFarShellActive: () => longView.infiniteFarShell !== undefined,
      isLongView: longView.isLongView,
      phase0TargetVisibleM: longView.phase0TargetVisibleM,
      phase0Config: longView.phase0Config,
      queryScene: longView.queryScene,
      phase0VelocityX: longView.phase0VelocityX,
      phase0VelocityZ: longView.phase0VelocityZ,
      phase0Streaming: longView.phase0Streaming,
      longViewDiagnosticsCfg: {
        page: {
          chunk_size: cfg.page.chunk_size,
          chunks_per_page: cfg.page.chunks_per_page,
        },
      },
      getFarShellRadiusFactor: () => state.farShellRadiusFactor,
      getShadowProxyInert: () => readShadowProxyCounters().shadow_proxy_inert,
      getShadowProxyEnabled: () => readShadowProxyCounters().shadow_proxy_enabled,
    },
    farSummary: input.onFarSummaryUpdate
      ? { onFarSummaryUpdate: (frameIndex, deltaSeconds, camera) => {
          input.onFarSummaryUpdate!(frameIndex, deltaSeconds, camera);
          session.naadfStatsController?.updateDisplay();
        } }
      : session.naadfStatsController
        ? { onFarSummaryUpdate: () => { session.naadfStatsController?.updateDisplay(); } }
        : undefined,
    construction: constructionController
      ? {
          update: () => {
            constructionController.update();
            session.constructionBuildActive = constructionController.stats().active;
          },
          isActive: () => constructionController.stats().active,
        }
      : undefined,
    combat: session.combatController
      ? { update: (timeMs) => session.combatController!.update(timeMs) }
      : undefined,
  });
}
