import { createClodPocGui } from "../../ui/gui/gui_root.js";
import type GUI from "lil-gui";
import { type NodeView, recomputedNormalsFor } from "./bootstrap_types.js";
import type { InfoPanelController } from "./info_panel_startup.js";
import type { UiStartupContext } from "./ui_startup_context.js";

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
  });

  colorByLodController.current = guiResult.colorByLodController;
  session.weatherStatsController = guiResult.weatherStatsController;
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
