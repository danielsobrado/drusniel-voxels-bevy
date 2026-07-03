import type { GrassStats } from "../../../grass.js";
import type { StoneStats } from "../../../stones/stone_instances.js";
import type { TreeStats } from "../../../trees/index.js";
import type { UnderstoryStats } from "../../../understory/index.js";
import type { ForestLightingStats } from "../../../forest_lighting/index.js";
import { bindClodFrameLoop } from "../../clod_frame_loop.js";
import { GpuPassTiming } from "../../../core/gpu_pass_timing.js";
import { TreeTimingPass } from "../../frame_loop/tree_timing_pass.js";
import { resolveSlowFrameMsThreshold } from "../../runtime_config.js";
import { shadowProxyStatsToCounters } from "../../../shadows/shadowProxyStats.js";
import { createDynamicResolutionController } from "../../../rendering/dynamic_resolution.js";
import {
  RENDER_RESOLUTION_CHANGED_EVENT,
  type RenderResolutionChangedEventDetail,
} from "../../../rendering/render_resolution_runtime.js";
import { parseSunLightOptions } from "../../../terrain/sun_visibility/sun_light_options.js";
import { createLightUpdate } from "../../../terrain/sun_visibility/light_update.js";
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
    terrainColliders,
    terrainRaycast,
    worldCells,
    maxTerrainLevel,
    longView,
    floatingOrigin,
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
  const streamingScene = longView.queryScene?.startsWith("infinite-") ?? false;
  const combatController = session.combatController;
  const spellVfxController = session.spellVfxController;
  const clodShadowOverlayController = session.clodShadowOverlayController;

  if (!session.playerInputController) {
    throw new Error("Frame loop startup requires playerInputController");
  }

  if (customProps?.propController) {
    player.attachPropColliders(customProps.propController.colliderSet);
  }

  constructionController?.setTerrainConformHandler((request) => {
    terrainEdit.scheduleConstructionTerrainConform(request);
  });

  const grassProfileEnabled = searchParams.get("grassProfile") === "1";
  const grassPrepassEnabled = searchParams.get("prepass") !== "0";
  const profileFrameMs = resolveSlowFrameMsThreshold(searchParams, clodRuntime.profiling.slowFrameMs);
  const sunLightOptions = parseSunLightOptions({
    active: searchParams.get("sunLightCache") !== "0",
    diagnostics: searchParams.get("sunLightStats") === "1",
    debug_view: {
      active: searchParams.get("sunLightDebug") === "1",
    },
  });
  const sunLightRuntime = window.__drusnielTerrainSummary
    ? createLightUpdate({ terrainSummary: window.__drusnielTerrainSummary, options: sunLightOptions })
    : null;
  const syncSunLightCounters = () => {
    const sunStats = sunLightRuntime?.stats();
    if (!sunStats || !longView.hooks?.stats) return;
    const counters = longView.hooks.stats.counters;
    counters["sunLightCache.active"] = sunStats.active ? 1 : 0;
    counters["sunLightCache.entries"] = sunStats.entries;
    counters["sunLightCache.pendingTiles"] = sunStats.pendingTiles;
    counters["sunLightCache.hits"] = sunStats.hits;
    counters["sunLightCache.misses"] = sunStats.misses;
    counters["sunLightCache.missingValues"] = sunStats.missingValues;
    counters["sunLightCache.evictions"] = sunStats.evictions;
    counters["sunLightCache.refreshes"] = sunStats.refreshes;
    counters["sunLightCache.tilesBuiltThisFrame"] = sunStats.tilesBuiltThisFrame;
    counters["sunLightCache.buildMsLastFrame"] = sunStats.buildMsLastFrame;
    counters["sunLightCache.buildMsAvg"] = sunStats.buildMsAvg;
  };

  const wantGpuTiming = searchParams.get("perfProbe") === "1" || searchParams.get("gpuTiming") === "1";
  const gpuTimestampReady = input.app.isWebGpu
    && (input.app.renderer.backend as unknown as { trackTimestamp?: boolean }).trackTimestamp === true;
  const gpuPassTiming = input.app.isWebGpu
    ? new GpuPassTiming(input.app.renderer, gpuTimestampReady, wantGpuTiming && gpuTimestampReady)
    : null;
  const initialRenderResolution = window.__drusnielRenderResolution?.current();
  const treeTimingPass: TreeTimingPass | null = input.app.isWebGpu && wantGpuTiming && gpuTimestampReady
    ? new TreeTimingPass(
        input.app.renderer,
        initialRenderResolution?.physicalWidth ?? window.innerWidth,
        initialRenderResolution?.physicalHeight ?? window.innerHeight,
      )
    : null;
  const dynamicResolutionController = createDynamicResolutionController(
    clodRuntime.renderResolution.dynamic,
    window.__drusnielRenderResolution ?? null,
    searchParams,
  );

  const resizeDependentTargets = (detail: RenderResolutionChangedEventDetail) => {
    postProcess?.setSize(detail.resolution.cssWidth, detail.resolution.cssHeight);
    treeTimingPass?.setSize(detail.resolution.physicalWidth, detail.resolution.physicalHeight);
  };

  window.addEventListener(RENDER_RESOLUTION_CHANGED_EVENT, (event) => {
    resizeDependentTargets((event as CustomEvent<RenderResolutionChangedEventDetail>).detail);
  });

  window.addEventListener("resize", () => {
    const renderResolution = window.__drusnielRenderResolution;
    if (renderResolution) {
      renderResolution.applyCurrentViewport({ renderer, camera });
      return;
    }

    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    postProcess?.setSize(window.innerWidth, window.innerHeight);
    treeTimingPass?.setSize(window.innerWidth, window.innerHeight);
  });

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
      dynamicResolution: dynamicResolutionController,
      gpuPassTiming,
      runGpuTreeTiming: treeTimingPass
        ? () => treeTimingPass.render(treeSystem, camera)
        : null,
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
      pruneRenderNodeCache: input.terrainView.renderNodeCache.prune.bind(input.terrainView.renderNodeCache),
      drainClodApplyQueue: input.terrainView.drainClodApplyQueue,
      getClodApplyStats: input.terrainView.getClodApplyStats,
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
      propStats: customProps?.propStats ?? null,
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
      getPageGeometryCacheStats: () => input.terrainView.pageGeometryCache.stats(),
      getRenderNodeCacheStats: () => input.terrainView.renderNodeCache.stats(),
      statsPresenter,
      updateInfo,
      averageFpsRef: session.averageFpsRef,
      statsSyncThrottleConfig: clodRuntime.stats,
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
    farSummary: input.onFarSummaryUpdate || session.naadfStatsController || streamingScene || sunLightRuntime
      ? { onFarSummaryUpdate: (frameIndex, deltaSeconds, camera) => {
          if (streamingScene) farShellController.moveTo(camera.position.x, camera.position.z);
          sunLightRuntime?.update(camera, currentLighting().sunDirection, frameIndex, performance.now());
          syncSunLightCounters();
          input.onFarSummaryUpdate?.(frameIndex, deltaSeconds, camera);
          session.naadfStatsController?.updateDisplay();
        } }
      : undefined,
    floatingOrigin: floatingOrigin ? { controller: floatingOrigin, terrainColliders } : undefined,
    construction: constructionController
      ? {
          update: () => {
            constructionController.update();
            session.constructionBuildActive = constructionController.stats().active;
          },
          isActive: () => constructionController.stats().active,
        }
      : undefined,
    combat: combatController
      ? { update: (timeMs) => combatController.update(timeMs) }
      : undefined,
    spells: spellVfxController
      ? { update: (timeMs) => spellVfxController.update(timeMs) }
      : undefined,
    clodShadow: clodShadowOverlayController
      ? {
          update: () => clodShadowOverlayController.update(),
          statsController: session.clodShadowStatsController,
          isActive: () => state.clodShadowOverlayMode !== "off" || state.clodShadowProxyView !== "off",
        }
      : undefined,
  });
}
