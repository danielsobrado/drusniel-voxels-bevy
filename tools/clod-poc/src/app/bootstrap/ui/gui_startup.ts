import * as THREE from "three";
import { createClodPocGui } from "../../../ui/gui/gui_root.js";
import { createSceneGui } from "../../../ui/gui/scene_gui.js";
import { shadowProxyDebugStateToConfig } from "../../../shadows/shadowProxyDebug.js";
import { createClodShadowOverlayController } from "../../../clod_shadow_overlay_controller.js";
import type GUI from "lil-gui";
import { type NodeView, recomputedNormalsFor } from "../bootstrap_types.js";
import type { InfoPanelController } from "../info_panel_startup.js";
import type { UiStartupContext } from "../ui_startup_context.js";

const setQueryFlag = (key: string, enabled: boolean) => {
  const next = new URLSearchParams(location.search);
  if (enabled) next.set(key, "1");
  else next.delete(key);
  history.replaceState(null, "", `${location.pathname}${next.toString() ? `?${next.toString()}` : ""}${location.hash}`);
};

export interface GuiStartupResult {
  gui: GUI;
}

export function runGuiStartup(
  ctx: UiStartupContext,
  infoPanel: InfoPanelController,
): GuiStartupResult {
  const { input, session } = ctx;
  const {
    WORLD,
    clodRuntime,
    state,
    bindings,
    colorByLodUserOverride,
    colorByLodController,
    statControllers,
    isWebGpu,
    ensureClodErrorCompute,
    treeConfig,
    understoryConfig,
    renderer,
  } = input;
  const {
    views,
    materialController,
    selectionController,
    farShellController,
    nodeLabelOverlay,
    updateSelection,
    applyColorByLodToMaterials,
    postProcess,
    currentPostProcessSettings,
    shadowProxyDebugState,
    getShadowProxyConfig,
    setShadowProxyConfig,
    shadowProxyController,
  } = input.terrainView;
  const {
    grassController,
    stoneController,
    treeController,
    understoryController,
    forestLightingController,
    treeSystem,
    understorySystem,
    waterController,
    waterDebugState,
    makeWaterVisual,
    weatherController,
    applyWeatherSettings,
    updateLighting,
    visibleStoneClasses,
    onStoneScatterComplete,
  } = input.runtime;
  const { applyColorAdjustmentsToTerrain } = input.terrainView;
  const { updateInfo, applyClodPerfMode } = infoPanel;

  const farSummaryIntegration = (window as unknown as Record<string, unknown>).__drusnielFarSummary;

  const clodShadowOverlayController = createClodShadowOverlayController({
    roots: () => input.result.roots,
    camera: input.camera,
    renderer: input.renderer,
    scene: input.scene,
    state,
    getSelectionCenter: () => {
      const center = input.terrainView.selectionController.currentTerrainViews();
      if (center.size === 0) return input.controls.target;
      let cx = 0, cz = 0, count = 0;
      for (const v of center) {
        cx += v.node.footprint.minX + (v.node.footprint.maxX - v.node.footprint.minX) / 2;
        cz += v.node.footprint.minZ + (v.node.footprint.maxZ - v.node.footprint.minZ) / 2;
        count++;
      }
      return count > 0
        ? new THREE.Vector3(cx / count, 0, cz / count)
        : input.controls.target;
    },
    nearFieldRadius: () => state.bubble ? state.bubbleRadius : 0,
  });
  session.clodShadowOverlayController = clodShadowOverlayController;

  const guiResult = createClodPocGui(state, {
    clod: {
      world: WORLD,
      worldOptions: clodRuntime.runtime.worldOptions,
      isWebGpu,
      views: views.values(),
      materialController,
      selectionController,
      farShellController,
      nodeLabelOverlay,
      applyClodPerfMode,
      setMaterialTiersQuery: (enabled) => setQueryFlag("materialTiers", enabled),
      setWebGpuSelectionQuery: (enabled) => setQueryFlag("webgpuSelection", enabled),
      ensureClodErrorCompute,
      updateSelection,
      updateInfo,
      applyColorByLodToMaterials,
      setColorByLodUserOverride: (on) => { colorByLodUserOverride.value = on; },
      recomputedNormalsFor: (view) => recomputedNormalsFor(view as NodeView),
    },
    environment: {
      updateLighting,
      applyColorAdjustmentsToTerrain,
      currentPostProcessSettings,
      postProcess,
    },
    weather: {
      weatherController,
      applyWeatherSettings,
    },
    vegetation: {
      grassController,
      stoneController,
      treeController,
      understoryController,
      forestLightingController,
      farShellController,
      treeSystem,
      understorySystem,
      treeConfig,
      understoryConfig,
      renderer,
      visibleStoneClasses,
      updateInfo,
      bakeImpostorsOnStart: treeConfig.impostors.bakeOnStart,
      impostorsEnabled: treeConfig.impostors.enabled,
    },
    water: {
      waterController,
      waterDebugState,
      makeWaterVisual,
      setWaterEnabled: (enabled) => { state.waterEnabled = enabled; },
      setWaterDebugMode: (mode) => { state.waterDebugMode = mode; },
      setWaterClipmapTint: (enabled) => { state.waterClipmapTint = enabled; },
      setWaterWireframe: (enabled) => { state.waterWireframe = enabled; },
      setWaterDepthWrite: (on) => { state.waterDepthWrite = on; },
    },
    longView: input.longView.infiniteFarShell || input.longView.farShellMetrics ? {
      state,
      farSummaryIntegration: farSummaryIntegration as import("../../../far-summary/integration.js").FarSummaryIntegration | undefined,
      infiniteFarShell: input.longView.infiniteFarShell,
    } : undefined,
    shadowProxy: shadowProxyController && shadowProxyDebugState ? {
      shadowProxyController,
      farShellController,
      infiniteFarShell: input.longView.infiniteFarShell,
      getDebugState: () => shadowProxyDebugState,
      setDebugState: (next) => {
        Object.assign(shadowProxyDebugState, next);
        setShadowProxyConfig(shadowProxyDebugStateToConfig(shadowProxyDebugState, getShadowProxyConfig()));
      },
      getBaseConfig: getShadowProxyConfig,
      updateInfo,
    } : undefined,
    naadf: input.naadfIntegration ? {
      getIntegration: () => input.naadfIntegration,
    } : undefined,
    clodShadow: {
      updateOverlay: () => clodShadowOverlayController.update(),
      updateInfo,
    },
  });
  createSceneGui(guiResult.gui);
  session.clodShadowStatsController = guiResult.clodShadowStatsController;
  clodShadowOverlayController.update();
  guiResult.clodShadowStatsController?.updateDisplay();
  infoPanel.updateInfo();

  colorByLodController.current = guiResult.colorByLodController;
  session.weatherStatsController = guiResult.weatherStatsController;
  session.naadfStatsController = guiResult.naadfStatsController;
  bindings.refreshGrassStats = guiResult.refreshGrassStats;
  bindings.refreshTreeStats = guiResult.refreshTreeStats;
  bindings.refreshUnderstoryStats = guiResult.refreshUnderstoryStats;
  onStoneScatterComplete.current = guiResult.onStoneScatterComplete;
  statControllers.forestLightingStats = guiResult.forestLightingStatsController;
  ({
    grassBladeCount: session.grassBladeCountController,
    grassVisiblePatches: session.grassVisiblePatchesController,
    grassTierSummary: session.grassTierSummaryController,
    grassEdgeSuppressed: session.grassEdgeSuppressedController,
    grassCandidateCount: session.grassCandidateCountController,
    stoneTotal: statControllers.stoneTotal,
    stoneClassSummary: statControllers.stoneClassSummary,
    stoneVisible: statControllers.stoneVisible,
    treeTotal: statControllers.treeTotal,
    treeVisiblePatches: statControllers.treeVisiblePatches,
    treeLodSummary: statControllers.treeLodSummary,
    treeGpuSummary: statControllers.treeGpuSummary,
    understoryTotal: statControllers.understoryTotal,
    understoryVisiblePatches: statControllers.understoryVisiblePatches,
    understoryClassSummary: statControllers.understoryClassSummary,
    understoryGpuSummary: statControllers.understoryGpuSummary,
  } = guiResult.statControllers);

  return { gui: guiResult.gui };
}
