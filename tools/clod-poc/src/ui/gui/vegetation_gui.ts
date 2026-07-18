import type GUI from "lil-gui";
import type { ClodAppState } from "../../app/clod_app_state.js";
import { FAR_SHELL_DEFAULTS } from "../../app/clod_constants.js";
import type { PostProcessQualityPreset } from "../../app/state/postprocess_quality_presets.js";
import { applyTreeQualityPreset, TREE_SHADOW_MAX_LOD_VALUES } from "../../app/state/tree_quality_presets.js";
import { GRASS_DEPTH_PREPASS_TIER_MAX, GRASS_DEPTH_PREPASS_TIER_MIN } from "../../grass/grass_depth_prepass_runtime.js";
import { GRASS_SHADER_MODES } from "../../grass.js";
import type { GrassController } from "../../runtime/vegetation/grass_controller.js";
import type { StoneController } from "../../runtime/vegetation/stone_controller.js";
import type { TreeController } from "../../runtime/vegetation/tree_controller.js";
import { formatTreePerfSnapshot } from "../../runtime/vegetation/tree_perf_snapshot.js";
import type { UnderstoryController } from "../../runtime/vegetation/understory_controller.js";
import type { ForestLightingController } from "../../runtime/forest_lighting/forest_lighting_controller.js";
import type { FarShellController } from "../../systems/far_shell_controller.js";
import { TREE_DEPTH_PREPASS_MAX_LODS } from "../../trees/tree_depth_prepass_runtime.js";
import type { TreeSettings } from "../../trees/index.js";
import { understoryDepthPrepassFromQuery } from "../../understory/understory_depth_prepass_runtime.js";
import type { UnderstorySettings } from "../../understory/understory_config.js";
import type { GuiController } from "./gui_controller.js";

export const TREE_DISTANCE_GUI_MAX_M = 1600;
export const TREE_GPU_VISIBLE_GUI_MAX = 160_000;

export interface VegetationGuiDeps {
  grassController: GrassController;
  stoneController: StoneController;
  treeController: TreeController;
  understoryController: UnderstoryController;
  forestLightingController: ForestLightingController;
  farShellController: FarShellController;
  treeSystem: { updateSettings: (partial: Partial<TreeSettings>) => void };
  understorySystem: { updateSettings: (partial: Partial<UnderstorySettings>) => void };
  treeConfig: TreeSettings;
  understoryConfig: UnderstorySettings;
  renderer: unknown;
  visibleStoneClasses: () => ReturnType<StoneController["visibleClasses"]>;
  updateInfo: () => void;
  bakeImpostorsOnStart: boolean;
  impostorsEnabled: boolean;
}

export interface VegetationGuiStatControllers {
  grassBladeCount: GuiController | null;
  grassVisiblePatches: GuiController | null;
  grassTierSummary: GuiController | null;
  grassEdgeSuppressed: GuiController | null;
  grassCandidateCount: GuiController | null;
  stoneTotal: GuiController | null;
  stoneClassSummary: GuiController | null;
  stoneVisible: GuiController | null;
  treeTotal: GuiController | null;
  treeVisiblePatches: GuiController | null;
  treeLodSummary: GuiController | null;
  treeGpuSummary: GuiController | null;
  treeImpostorSummary: GuiController | null;
  understoryTotal: GuiController | null;
  understoryVisiblePatches: GuiController | null;
  understoryClassSummary: GuiController | null;
  understoryGpuSummary: GuiController | null;
}

export interface VegetationGuiResult {
  refreshGrassStats: () => void;
  refreshStoneStats: () => void;
  onStoneScatterComplete: () => void;
  refreshTreeStats: () => void;
  refreshUnderstoryStats: () => void;
  forestLightingStatsController: GuiController | null;
  statControllers: VegetationGuiStatControllers;
}

export function createVegetationGui(
  gui: GUI,
  state: ClodAppState,
  deps: VegetationGuiDeps,
): VegetationGuiResult {
  let grassBladeCountController: GuiController | null = null;
  let grassVisiblePatchesController: GuiController | null = null;
  let grassTierSummaryController: GuiController | null = null;
  let grassEdgeSuppressedController: GuiController | null = null;
  let grassCandidateCountController: GuiController | null = null;
  let grassPatchRebuildCountController: GuiController | null = null;
  let grassBuildMsController: GuiController | null = null;
  let grassDepthPrepassEnabledController: GuiController | null = null;
  let grassDepthPrepassTierController: GuiController | null = null;

  const refreshGrassStats = () => {
    deps.grassController.refreshStats();
    grassBladeCountController?.updateDisplay();
    grassVisiblePatchesController?.updateDisplay();
    grassTierSummaryController?.updateDisplay();
    grassEdgeSuppressedController?.updateDisplay();
    grassCandidateCountController?.updateDisplay();
    grassPatchRebuildCountController?.updateDisplay();
    grassBuildMsController?.updateDisplay();
    grassDepthPrepassEnabledController?.updateDisplay();
    grassDepthPrepassTierController?.updateDisplay();
  };

  const grassActions = {
    rebuild: () => {
      deps.grassController.rebuild();
      refreshGrassStats();
      deps.updateInfo();
    },
  };
  const updateGrassUniforms = () => deps.grassController.applySettings();
  const applyGrassDepthPrepassTier = (tier: number) => {
    deps.grassController.setDepthPrepassTier(tier);
    refreshGrassStats();
    deps.updateInfo();
  };
  const grassFolder = gui.addFolder("grass shader");
  const grassShaderOptions = Object.fromEntries(
    GRASS_SHADER_MODES.map((mode) => [
      mode === "terrain-patch-v2"
        ? "terrain patch v2"
        : mode === "webgpu-ring-v1" ? "webgpu ring v1" : "classic",
      mode,
    ]),
  );
  grassFolder.add(state, "grassEnabled").name("enabled").onChange((enabled: boolean) => {
    deps.grassController.setEnabled(enabled);
    refreshGrassStats();
    deps.updateInfo();
  });
  grassFolder.add(state, "grassRingDebug").name("ring debug log").onChange((on: boolean) => {
    deps.grassController.setRingDebug(on);
  });
  grassFolder.add(state, "grassShaderMode", grassShaderOptions).name("shader").onChange(grassActions.rebuild);
  grassDepthPrepassEnabledController = grassFolder.add(state, "grassDepthPrepassEnabled")
    .name("depth prepass")
    .onChange((enabled: boolean) => {
      const tier = enabled ? Math.max(1, state.grassDepthPrepassTier || GRASS_DEPTH_PREPASS_TIER_MAX) : 0;
      applyGrassDepthPrepassTier(tier);
    });
  grassDepthPrepassTierController = grassFolder.add(
    state,
    "grassDepthPrepassTier",
    GRASS_DEPTH_PREPASS_TIER_MIN,
    GRASS_DEPTH_PREPASS_TIER_MAX,
    1,
  )
    .name("prepass tier 0/1/2")
    .onChange((tier: number) => applyGrassDepthPrepassTier(tier));
  grassFolder.add(state, "grassAlphaToCoverage").name("alpha to coverage").onChange(updateGrassUniforms);
  grassFolder.add(state, "grassNearCrossedQuads").name("near crossed quads").onChange(grassActions.rebuild);
  grassFolder.add(state, "grassDistance", 16, 512, 1).name("distance").onChange(updateGrassUniforms);
  grassFolder.add(state, "grassBladeSpacing", 0.4, 6, 0.1).name("blade spacing").onFinishChange(grassActions.rebuild);
  grassFolder.add(state, "grassBladeHeight", 0.2, 4, 0.05).name("blade height").onFinishChange(grassActions.rebuild);
  grassFolder.add(state, "grassBladeHeightVariation", 0, 1, 0.05).name("height variation").onFinishChange(grassActions.rebuild);
  grassFolder.add(state, "grassBladeWidth", 0.01, 0.4, 0.01).name("blade width").onChange(updateGrassUniforms);
  grassFolder.add(state, "grassWindStrength", 0, 1.5, 0.01).name("wind strength").onChange(updateGrassUniforms);
  grassFolder.add(state, "grassWindSpeed", 0, 4, 0.05).name("wind speed").onChange(updateGrassUniforms);
  grassFolder.add(state, "grassSlopeMinY", 0, 1, 0.01).name("slope min Y").onFinishChange(grassActions.rebuild);
  grassFolder.add(state, "grassMinHeight", 0, 128, 1).name("min height").onFinishChange(grassActions.rebuild);
  grassFolder.add(state, "grassMaxHeight", 0, 128, 1).name("max height").onFinishChange(grassActions.rebuild);
  grassFolder.add(state, "grassMaxBlades", 0, 100000, 1000).name("max blades").onFinishChange(grassActions.rebuild);
  grassFolder.add(state, "grassSeed", 0, 100000, 1).name("seed").onFinishChange(grassActions.rebuild);
  grassBladeCountController = grassFolder.add(state, "grassBladeCount").name("blade count").disable();
  grassVisiblePatchesController = grassFolder.add(state, "grassVisiblePatches").name("visible patches").disable();
  grassTierSummaryController = grassFolder.add(state, "grassTierSummary").name("near/mid/far/super").disable();
  grassEdgeSuppressedController = grassFolder.add(state, "grassEdgeSuppressed").name("edge suppressed").disable();
  grassCandidateCountController = grassFolder.add(state, "grassCandidateCount").name("candidates").disable();
  grassPatchRebuildCountController = grassFolder.add(state, "grassPatchRebuildCount").name("patch rebuilds").disable();
  grassBuildMsController = grassFolder.add(state, "grassBuildMs").name("build ms").disable();
  grassFolder.add(grassActions, "rebuild").name("rebuild");

  const farShellFolder = gui.addFolder("far shell");
  farShellFolder.add(state, "farShellEnabled").name("enabled").onChange((enabled: boolean) => {
    if (enabled) {
      if (!deps.farShellController.isBuilt()) {
        deps.farShellController.rebuild();
      } else {
        deps.farShellController.setEnabled(true);
      }
    } else {
      deps.farShellController.setEnabled(false);
    }
    deps.updateInfo();
  });
  farShellFolder.add(
    state,
    "farShellRadiusFactor",
    FAR_SHELL_DEFAULTS.radiusFactorMin,
    FAR_SHELL_DEFAULTS.radiusFactorMax,
    0.05,
  )
    .name("far radius (×world)")
    .onFinishChange(() => deps.farShellController.rebuild());
  farShellFolder.add(state, "farShellHeightBias", 0, 1, 0.01)
    .name("height bias")
    .onFinishChange(() => deps.farShellController.rebuild());
  farShellFolder.add(state, "farShellHeightDrop", 0, 10, 0.1)
    .name("height drop")
    .onFinishChange(() => deps.farShellController.rebuild());
  farShellFolder.add({ rebuild: () => deps.farShellController.rebuild() }, "rebuild").name("rebuild");

  const refreshStoneStats = () => {
    deps.stoneController.refreshStats();
  };
  const onStoneScatterComplete = () => {
    refreshStoneStats();
    deps.updateInfo();
  };
  const stoneActions = {
    rebuild: () => {
      deps.stoneController.rebuild();
      deps.updateInfo();
    },
  };
  const stoneFolder = gui.addFolder("stones (props)");
  stoneFolder.add(state, "stonesEnabled").name("enabled").onChange((enabled: boolean) => {
    deps.stoneController.setEnabled(enabled);
    refreshStoneStats();
    deps.updateInfo();
  });
  stoneFolder.add(state, "stoneDensity", 0, 2, 0.05).name("density").onFinishChange(stoneActions.rebuild);
  stoneFolder.add(state, "stoneMaxInstances", 0, 500000, 1000).name("max instances").onFinishChange(stoneActions.rebuild);
  stoneFolder.add(state, "stoneSeed", 0, 1000000, 1).name("seed").onFinishChange(stoneActions.rebuild);
  stoneFolder.add(state, "stoneShowLarge").name("show large").onChange(() => deps.stoneController.setVisibleClasses(deps.visibleStoneClasses()));
  stoneFolder.add(state, "stoneShowMedium").name("show medium").onChange(() => deps.stoneController.setVisibleClasses(deps.visibleStoneClasses()));
  stoneFolder.add(state, "stoneShowSmall").name("show small").onChange(() => deps.stoneController.setVisibleClasses(deps.visibleStoneClasses()));
  const stoneTotalController = stoneFolder.add(state, "stoneTotal").name("total").disable();
  const stoneClassSummaryController = stoneFolder.add(state, "stoneClassSummary").name("L/M/S").disable();
  const stoneVisibleController = stoneFolder.add(state, "stoneVisible").name("visible").disable();
  stoneFolder.add(stoneActions, "rebuild").name("rebuild");

  const refreshTreeStats = () => {
    deps.treeController.refreshStats();
  };
  const updateTreeWindSettings = () => deps.treeSystem.updateSettings({
    wind: {
      ...deps.treeController.makeSettings().wind,
      enabled: state.treeWindEnabled as boolean,
      strength: state.treeWindStrength as number,
      speed: state.treeWindSpeed as number,
      gustStrength: state.treeGustStrength as number,
      trunkSwayStrength: state.treeTrunkSwayStrength as number,
      leafFlutterStrength: state.treeLeafFlutterStrength as number,
    },
  });
  const updateTreeRenderSettings = () => {
    deps.treeSystem.updateSettings({
      render: {
        ...deps.treeController.makeSettings().render,
        debugColorByLod: state.treeDebugColorByLod as boolean,
        farCheapMaterial: state.treeFarCheapMaterial as boolean,
        placementDebug: state.treePlacementDebug as boolean,
      },
    });
    refreshTreeStats();
    deps.updateInfo();
  };
  const updateTreeImpostorSettings = () => {
    deps.treeSystem.updateSettings({
      impostors: {
        ...deps.treeController.makeSettings().impostors,
        swapOnBake: state.treeImpostorSwapOnBake as boolean,
      },
    });
    refreshTreeStats();
    deps.updateInfo();
  };
  const updateTreeGpuSettings = () => {
    deps.treeSystem.updateSettings({
      gpu: {
        ...deps.treeController.makeSettings().gpu,
        enabled: state.treeGpuEnabled as boolean,
        fallbackToCpu: state.treeGpuFallbackToCpu as boolean,
        debugForceCpu: state.treeGpuForceCpu as boolean,
        debugShowGpuCounts: state.treeGpuShowCounts as boolean,
        readbackVisibleLists: state.treeGpuReadbackVisibleLists as boolean,
        debugValidateAgainstCpu: state.treeGpuValidateAgainstCpu as boolean,
        maxVisible: state.treeGpuMaxVisible as number,
      },
    });
    refreshTreeStats();
    deps.updateInfo();
  };
  const updateTreeDepthPrepass = () => {
    deps.treeController.setDepthPrepassMaxLod(state.treeDepthPrepassMaxLod);
    refreshTreeStats();
    deps.updateInfo();
  };
  const treeActions = {
    rebuild: () => {
      deps.treeController.rebuild();
      if (deps.impostorsEnabled && deps.bakeImpostorsOnStart && state.treeImpostorSwapOnBake) {
        void deps.treeController.bakeImpostors(deps.renderer);
      }
      deps.updateInfo();
    },
    snapshot: () => {
      refreshTreeStats();
      const url = typeof window === "undefined" ? undefined : `${window.location.pathname}${window.location.search}`;
      console.info(formatTreePerfSnapshot({ state, stats: deps.treeController.system.getStats(), url }));
    },
  };
  const treeFolder = gui.addFolder("trees (props)");
  const treeSettingControllers: GuiController[] = [];
  const refreshTreeSettingControllers = () => {
    for (const controller of treeSettingControllers) controller.updateDisplay();
  };
  const applyTreePreset = (preset: Exclude<PostProcessQualityPreset, "custom">) => {
    applyTreeQualityPreset(state, preset);
    treeActions.rebuild();
    refreshTreeSettingControllers();
  };
  const treePresetActions = {
    ultra: () => applyTreePreset("ultra"),
    balanced: () => applyTreePreset("balanced"),
    perf: () => applyTreePreset("perf"),
    potato: () => applyTreePreset("potato"),
  };
  treeFolder.add(treePresetActions, "ultra").name("preset: ultra");
  treeFolder.add(treePresetActions, "balanced").name("preset: balanced");
  treeFolder.add(treePresetActions, "perf").name("preset: perf");
  treeFolder.add(treePresetActions, "potato").name("preset: potato");
  treeFolder.add(state, "treesEnabled").name("enabled").onChange((enabled: boolean) => {
    deps.treeController.setEnabled(enabled);
    refreshTreeStats();
    deps.updateInfo();
  });
  treeFolder.add(state, "treeDepthPrepassMaxLod", [...TREE_DEPTH_PREPASS_MAX_LODS]).name("depth prepass max LOD").onChange(updateTreeDepthPrepass);
  treeSettingControllers.push(
    treeFolder.add(state, "treeDistance", 0, TREE_DISTANCE_GUI_MAX_M, 5).name("active ring m").onFinishChange(treeActions.rebuild),
    treeFolder.add(state, "treeMaxInstances", 0, 20000, 100).name("max instances").onFinishChange(treeActions.rebuild),
    treeFolder.add(state, "treeDensity", 0, 2, 0.05).name("density").onFinishChange(treeActions.rebuild),
    treeFolder.add(state, "treeSpacing", 0.5, 24, 0.25).name("spacing m").onFinishChange(treeActions.rebuild),
    treeFolder.add(state, "treeShadowMaxLod", [...TREE_SHADOW_MAX_LOD_VALUES]).name("shadow max LOD").onFinishChange(treeActions.rebuild),
  );
  treeFolder.add(state, "treeDebugColorByLod").name("debug color by LOD").onChange(updateTreeRenderSettings);
  treeFolder.add(state, "treeFarCheapMaterial").name("cheap far material").onChange(updateTreeRenderSettings);
  treeFolder.add(state, "treePlacementDebug").name("placement debug").onChange(updateTreeRenderSettings);
  treeFolder.add(state, "treeImpostorSwapOnBake").name("swap impostors on bake").onChange(updateTreeImpostorSettings);
  treeSettingControllers.push(
    treeFolder.add(state, "treeGpuEnabled").name("GPU ring").onChange(updateTreeGpuSettings),
    treeFolder.add(state, "treeGpuFallbackToCpu").name("fallback to CPU").onChange(updateTreeGpuSettings),
    treeFolder.add(state, "treeGpuForceCpu").name("force CPU").onChange(updateTreeGpuSettings),
    treeFolder.add(state, "treeGpuShowCounts").name("show GPU counts").onChange(updateTreeGpuSettings),
    treeFolder.add(state, "treeGpuReadbackVisibleLists").name("GPU readback lists").onChange(updateTreeGpuSettings),
    treeFolder.add(state, "treeGpuValidateAgainstCpu").name("validate GPU vs CPU").onChange(updateTreeGpuSettings),
    treeFolder.add(state, "treeGpuMaxVisible", 0, TREE_GPU_VISIBLE_GUI_MAX, 1000).name("GPU max visible").onFinishChange(updateTreeGpuSettings),
  );
  treeFolder.add(state, "treeWindEnabled").name("wind enabled").onChange(updateTreeWindSettings);
  treeFolder.add(state, "treeWindStrength", 0, 1, 0.01).name("wind strength").onChange(updateTreeWindSettings);
  treeFolder.add(state, "treeWindSpeed", 0, 4, 0.05).name("wind speed").onChange(updateTreeWindSettings);
  treeFolder.add(state, "treeGustStrength", 0, 1, 0.01).name("gust strength").onChange(updateTreeWindSettings);
  treeFolder.add(state, "treeTrunkSwayStrength", 0, 1, 0.01).name("trunk sway").onChange(updateTreeWindSettings);
  treeFolder.add(state, "treeLeafFlutterStrength", 0, 1, 0.01).name("leaf flutter").onChange(updateTreeWindSettings);
  const treeTotalController = treeFolder.add(state, "treeTotal").name("total").disable();
  const treeVisiblePatchesController = treeFolder.add(state, "treeVisiblePatches").name("visible patches").disable();
  const treeLodSummaryController = treeFolder.add(state, "treeLodSummary").name("near/mid/far/impostor").disable();
  const treeGpuSummaryController = treeFolder.add(state, "treeGpuSummary").name("GPU").disable();
  const treeImpostorSummaryController = treeFolder.add(state, "treeImpostorSummary").name("impostors").disable();
  treeFolder.add(treeActions, "snapshot").name("log perf snapshot");
  treeFolder.add(treeActions, "rebuild").name("rebuild");

  const refreshUnderstoryStats = () => {
    deps.understoryController.refreshStats();
  };
  const updateUnderstoryRenderSettings = () => {
    deps.understorySystem.updateSettings({
      render: {
        ...deps.understoryConfig.render,
        debugColorByClass: state.understoryDebugColorByClass as boolean,
      },
    });
    refreshUnderstoryStats();
    deps.updateInfo();
  };
  const understoryDepthPrepassState = {
    enabled: typeof window !== "undefined" ? understoryDepthPrepassFromQuery(new URLSearchParams(window.location.search)) : false,
  };
  const understoryActions = {
    rebuild: () => {
      deps.understoryController.rebuild();
      deps.updateInfo();
    },
  };
  const understoryFolder = gui.addFolder("understory (props)");
  understoryFolder.add(state, "understoryEnabled").name("enabled").onChange((enabled: boolean) => {
    deps.understoryController.setEnabled(enabled);
    refreshUnderstoryStats();
    deps.updateInfo();
  });
  understoryFolder.add(understoryDepthPrepassState, "enabled").name("depth prepass").onChange((enabled: boolean) => {
    deps.understoryController.setDepthPrepassEnabled(enabled);
    refreshUnderstoryStats();
    deps.updateInfo();
  });
  understoryFolder.add(state, "understoryDistance", 0, 600, 5).name("distance").onFinishChange(understoryActions.rebuild);
  understoryFolder.add(state, "understoryMaxInstances", 0, 100000, 100).name("max instances").onFinishChange(understoryActions.rebuild);
  understoryFolder.add(state, "understoryDebugColorByClass").name("debug color by class").onChange(updateUnderstoryRenderSettings);
  const understoryTotalController = understoryFolder.add(state, "understoryTotal").name("total").disable();
  const understoryVisiblePatchesController = understoryFolder.add(state, "understoryVisiblePatches").name("visible patches").disable();
  const understoryClassSummaryController = understoryFolder.add(state, "understoryClassSummary").name("sh/f/sap/fl/log/stump").disable();
  const understoryGpuSummaryController = understoryFolder.add(state, "understoryGpuSummary").name("GPU").disable();
  understoryFolder.add(understoryActions, "rebuild").name("rebuild");

  const updateForestLightingSettings = () => {
    deps.forestLightingController.applySettings();
    deps.updateInfo();
  };
  const forestLightingFolder = gui.addFolder("forest lighting");
  forestLightingFolder.add(state, "forestLightingEnabled").name("enabled").onChange(updateForestLightingSettings);
  forestLightingFolder.add(state, "forestLightingAoStrength", 0, 1, 0.01).name("AO strength").onChange(updateForestLightingSettings);
  forestLightingFolder.add(state, "forestLightingShadowStrength", 0, 1, 0.01).name("shadow strength").onChange(updateForestLightingSettings);
  forestLightingFolder.add(state, "forestLightingFogStrength", 0, 1, 0.01).name("forest fog").onChange(updateForestLightingSettings);
  forestLightingFolder.add(state, "forestLightingSunShaftsStrength", 0, 1, 0.01).name("sun shafts").onChange(updateForestLightingSettings);
  forestLightingFolder.add(
    state,
    "forestLightingDebugMode",
    ["off", "canopy", "ao", "shadow", "fog", "sun_shafts", "combined"],
  ).name("debug mode").onChange(updateForestLightingSettings);
  const forestLightingStatsController = forestLightingFolder.add(state, "forestLightingStats").name("stats").disable();

  return {
    refreshGrassStats,
    refreshStoneStats,
    onStoneScatterComplete,
    refreshTreeStats,
    refreshUnderstoryStats,
    forestLightingStatsController,
    statControllers: {
      grassBladeCount: grassBladeCountController,
      grassVisiblePatches: grassVisiblePatchesController,
      grassTierSummary: grassTierSummaryController,
      grassEdgeSuppressed: grassEdgeSuppressedController,
      grassCandidateCount: grassCandidateCountController,
      stoneTotal: stoneTotalController,
      stoneClassSummary: stoneClassSummaryController,
      stoneVisible: stoneVisibleController,
      treeTotal: treeTotalController,
      treeVisiblePatches: treeVisiblePatchesController,
      treeLodSummary: treeLodSummaryController,
      treeGpuSummary: treeGpuSummaryController,
      treeImpostorSummary: treeImpostorSummaryController,
      understoryTotal: understoryTotalController,
      understoryVisiblePatches: understoryVisiblePatchesController,
      understoryClassSummary: understoryClassSummaryController,
      understoryGpuSummary: understoryGpuSummaryController,
    },
  };
}
