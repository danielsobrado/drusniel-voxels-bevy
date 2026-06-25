import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ClodHooks } from "../core/hooks.js";
import type { GrassStats, GrassSettings } from "../grass.js";
import type { StoneStats } from "../stones/stone_instances.js";
import type { TreeStats } from "../trees/index.js";
import type { UnderstoryStats } from "../understory/index.js";
import type { ForestLightingStats } from "../forest_lighting/index.js";
import type { PostProcessSettings } from "../postprocess.js";
import type { ClodSelectionController } from "../terrain_runtime/clod_selection_controller.js";
import type { NearFieldBubbleController } from "../terrain_runtime/near_field_bubble_controller.js";
import type { TerrainRaycastService } from "../player/terrain_raycast_service.js";
import type { PlayerInputController } from "../player/player_input_controller.js";
import type { BrushPreviewController } from "../player/brush_preview_controller.js";
import type { GrassController } from "../systems/grass_controller.js";
import type { TreeController } from "../systems/tree_controller.js";
import type { UnderstoryController } from "../systems/understory_controller.js";
import type { ForestLightingController } from "../systems/forest_lighting_controller.js";
import type { StoneController } from "../systems/stone_controller.js";
import type { WaterController } from "../systems/water_controller.js";
import type { WeatherController } from "../systems/weather_controller.js";
import type { NodeLabelOverlay } from "../ui/node_labels.js";
import type { AppPostProcess } from "./app_post_process.js";
import type { AppSky } from "../scene/app_sky.js";
import { createLongViewFrameDiagnostics } from "../phase0/long_view_frame_diagnostics.js";
import type { Phase0Config } from "../phase0/phase0_config.js";
import type { PlayerController, PlayerInteractionState } from "../player_controller.js";
import { runTerrainFramePhase } from "./frame_loop/terrain_frame_phase.js";
import { runVegetationFramePhase } from "./frame_loop/vegetation_frame_phase.js";
import { runStatsSyncPhase } from "./frame_loop/stats_sync_phase.js";
import { runRenderPhase } from "./frame_loop/render_phase.js";
import { submitMsChanged } from "./frame_loop/frame_timing.js";
import type { ClodFrameLoopUiState } from "./frame_loop/ui_state.js";
export type { ClodFrameLoopUiState } from "./frame_loop/ui_state.js";

interface TerrainFadeView {
  fade: number;
  target: number;
  mesh: THREE.Mesh;
  mat: { setFade: (fade: number, fadeIn: boolean, dither: boolean) => void };
}

interface NodeViewLookup {
  node: { id: string };
}

interface GuiDisplayController {
  updateDisplay: () => unknown;
}

export interface ClodFrameLoopDeps {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  player: PlayerController;
  interaction: PlayerInteractionState;
  state: ClodFrameLoopUiState;
  selectionController: ClodSelectionController;
  playerInputController: PlayerInputController;
  skyEnvironment: AppSky | null;
  drainVegetationDirtyQueue: () => void;
  treeController: TreeController;
  updateSelection: () => void;
  playerTerraformEditActive: () => boolean;
  brushPreview: BrushPreviewController;
  terrainRaycast: TerrainRaycastService;
  pageTransitionMode: string;
  crossfadeStep: number;
  nearFieldBubbleController: NearFieldBubbleController;
  views: Map<string, NodeViewLookup & TerrainFadeView>;
  worldCells: number;
  grassController: GrassController;
  understoryController: UnderstoryController;
  forestLightingController: ForestLightingController;
  applyForestLightingToPropMaterials: () => void;
  stoneController: StoneController;
  waterController: WaterController;
  weatherController: WeatherController;
  updateWeatherStats: () => void;
  weatherStatsController: GuiDisplayController | null;
  grassSystem: GrassController["system"];
  treeSystem: TreeController["system"];
  understorySystem: UnderstoryController["system"];
  forestLightingSystem: ForestLightingController["system"];
  stoneSystem: StoneController["system"];
  currentLighting: () => { sunDirection: THREE.Vector3 };
  getGrassStats: () => GrassStats | null;
  setGrassStats: (stats: GrassStats | null) => void;
  getTreeStats: () => TreeStats | null;
  setTreeStats: (stats: TreeStats | null) => void;
  getStoneStats: () => StoneStats | null;
  setStoneStats: (stats: StoneStats | null) => void;
  getUnderstoryStats: () => UnderstoryStats | null;
  setUnderstoryStats: (stats: UnderstoryStats | null) => void;
  getForestLightingStats: () => ForestLightingStats | null;
  setForestLightingStats: (stats: ForestLightingStats | null) => void;
  formatTreeGpuSummary: (stats: TreeStats) => string;
  formatUnderstoryGpuSummary: (stats: UnderstoryStats) => string;
  grassBladeCountController: GuiDisplayController | null;
  grassVisiblePatchesController: GuiDisplayController | null;
  grassTierSummaryController: GuiDisplayController | null;
  grassEdgeSuppressedController: GuiDisplayController | null;
  grassCandidateCountController: GuiDisplayController | null;
  treeTotalController: GuiDisplayController | null;
  treeVisiblePatchesController: GuiDisplayController | null;
  treeLodSummaryController: GuiDisplayController | null;
  treeGpuSummaryController: GuiDisplayController | null;
  stoneTotalController: GuiDisplayController | null;
  stoneClassSummaryController: GuiDisplayController | null;
  stoneVisibleController: GuiDisplayController | null;
  understoryTotalController: GuiDisplayController | null;
  understoryVisiblePatchesController: GuiDisplayController | null;
  understoryClassSummaryController: GuiDisplayController | null;
  understoryGpuSummaryController: GuiDisplayController | null;
  forestLightingStatsController: GuiDisplayController | null;
  nodeLabelOverlay: NodeLabelOverlay;
  postProcess: AppPostProcess | null;
  currentPostProcessSettings: () => PostProcessSettings;
  makeGrassSettings: () => GrassSettings;
  updateInfo: () => void;
  averageFpsRef: { value: number };
  getHooks: () => ClodHooks | null;
  longViewSettleWaiters: { frames: number; resolve: () => void }[];
  maxTerrainLevel: number;
  farShellBuilt: () => boolean;
  farShellCanopyEnabled: () => boolean;
  isLongView: boolean;
  phase0TargetVisibleM: number;
  phase0Config: Phase0Config;
  queryScene: string | null;
  phase0VelocityX: number;
  phase0VelocityZ: number;
  phase0Streaming: Phase0Config["phase0"]["streaming"];
  longViewDiagnosticsCfg: {
    page: { chunk_size: number; chunks_per_page: number };
  };
  getFarShellRadiusFactor: () => number;
  profileFrameMs: number;
  grassProfileEnabled: boolean;
  grassPrepassEnabled: boolean;
}

export function bindClodFrameLoop(deps: ClodFrameLoopDeps): void {
  let elapsedSeconds = 0;
  const averageFpsRef = deps.averageFpsRef;
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
      deps.updateInfo();
    }
  };

  let frameStart = 0;
  const updateLongViewDiagnostics = createLongViewFrameDiagnostics({
    getHooks: deps.getHooks,
    getAverageFps: () => averageFpsRef.value,
    getFrameStartMs: () => frameStart,
    renderer: deps.renderer,
    getSelectionStats: () => deps.selectionController.stats(),
    maxTerrainLevel: deps.maxTerrainLevel,
    getGrassStats: deps.getGrassStats,
    getTreeStats: deps.getTreeStats,
    getStoneStats: deps.getStoneStats,
    worldCells: deps.worldCells,
    getFarShellRadiusFactor: deps.getFarShellRadiusFactor,
    farShellBuilt: deps.farShellBuilt,
    farShellCanopyEnabled: deps.farShellCanopyEnabled,
    isLongView: deps.isLongView,
    phase0TargetVisibleM: deps.phase0TargetVisibleM,
    phase0Config: deps.phase0Config,
    queryScene: deps.queryScene,
    cfg: deps.longViewDiagnosticsCfg,
    camera: deps.camera,
    phase0VelocityX: deps.phase0VelocityX,
    phase0VelocityZ: deps.phase0VelocityZ,
    phase0Streaming: deps.phase0Streaming,
  });

  deps.renderer.setAnimationLoop(() => {
    frameStart = performance.now();
    deps.selectionController.advanceFrame();
    const selectionStats = deps.selectionController.stats();
    deps.playerInputController.playerTimer.update();
    const playerDelta = Math.min(deps.playerInputController.playerTimer.getDelta(), 0.1);
    elapsedSeconds += playerDelta;
    updateAverageFps();
    deps.playerInputController.updateFrame(playerDelta);
    deps.skyEnvironment?.updateCamera(deps.camera);
    deps.drainVegetationDirtyQueue();
    deps.treeController.updateFallingTrees(playerDelta);
    if (!deps.state.freeze) deps.updateSelection();

    updateLongViewDiagnostics();

    deps.playerInputController.updateHoldToDig();

    deps.brushPreview.update({
      digEnabled: deps.state.digEnabled,
      interactionMode: deps.interaction.mode,
      terraformEditActive: deps.playerTerraformEditActive(),
      brushShape: deps.state.brushShape,
      brushOp: deps.state.brushOp,
      digRadius: deps.state.digRadius,
      brushHeight: deps.state.brushHeight,
      raycastEditableTerrain: deps.terrainRaycast.raycastEditableTerrain,
      getPlayingAimRay: () => deps.playerInputController.getPlayingAimRay(),
      getOrbitHoverRay: () => deps.playerInputController.getOrbitHoverRay(),
    });

    const terrainPhase = runTerrainFramePhase({
      state: deps.state,
      pageTransitionMode: deps.pageTransitionMode,
      crossfadeStep: deps.crossfadeStep,
      interaction: deps.interaction,
      player: deps.player,
      controls: deps.controls,
      selectionController: deps.selectionController,
      nearFieldBubbleController: deps.nearFieldBubbleController,
      views: deps.views,
      worldCells: deps.worldCells,
    });

    runVegetationFramePhase({
      elapsedSeconds,
      playerDelta,
      ringCenter: terrainPhase.ringCenter,
      grassCenter: terrainPhase.grassCenter,
      camera: deps.camera,
      state: deps.state,
      grassController: deps.grassController,
      treeController: deps.treeController,
      understoryController: deps.understoryController,
      forestLightingController: deps.forestLightingController,
      applyForestLightingToPropMaterials: deps.applyForestLightingToPropMaterials,
      stoneController: deps.stoneController,
      waterController: deps.waterController,
      weatherController: deps.weatherController,
      updateWeatherStats: deps.updateWeatherStats,
      weatherStatsController: deps.weatherStatsController,
      currentLighting: deps.currentLighting,
      selectionFrameId: selectionStats.frameId,
      worldCells: deps.worldCells,
    });

    const { currentGrassStats } = runStatsSyncPhase({
      state: deps.state,
      grassSystem: deps.grassSystem,
      treeSystem: deps.treeSystem,
      stoneSystem: deps.stoneSystem,
      understorySystem: deps.understorySystem,
      forestLightingSystem: deps.forestLightingSystem,
      getGrassStats: deps.getGrassStats,
      setGrassStats: deps.setGrassStats,
      getTreeStats: deps.getTreeStats,
      setTreeStats: deps.setTreeStats,
      getStoneStats: deps.getStoneStats,
      setStoneStats: deps.setStoneStats,
      getUnderstoryStats: deps.getUnderstoryStats,
      setUnderstoryStats: deps.setUnderstoryStats,
      getForestLightingStats: deps.getForestLightingStats,
      setForestLightingStats: deps.setForestLightingStats,
      formatTreeGpuSummary: deps.formatTreeGpuSummary,
      formatUnderstoryGpuSummary: deps.formatUnderstoryGpuSummary,
      grassBladeCountController: deps.grassBladeCountController,
      grassVisiblePatchesController: deps.grassVisiblePatchesController,
      grassTierSummaryController: deps.grassTierSummaryController,
      grassEdgeSuppressedController: deps.grassEdgeSuppressedController,
      grassCandidateCountController: deps.grassCandidateCountController,
      treeTotalController: deps.treeTotalController,
      treeVisiblePatchesController: deps.treeVisiblePatchesController,
      treeLodSummaryController: deps.treeLodSummaryController,
      treeGpuSummaryController: deps.treeGpuSummaryController,
      stoneTotalController: deps.stoneTotalController,
      stoneClassSummaryController: deps.stoneClassSummaryController,
      stoneVisibleController: deps.stoneVisibleController,
      understoryTotalController: deps.understoryTotalController,
      understoryVisiblePatchesController: deps.understoryVisiblePatchesController,
      understoryClassSummaryController: deps.understoryClassSummaryController,
      understoryGpuSummaryController: deps.understoryGpuSummaryController,
      forestLightingStatsController: deps.forestLightingStatsController,
    });

    runRenderPhase({
      renderer: deps.renderer,
      scene: deps.scene,
      camera: deps.camera,
      postProcess: deps.postProcess,
      currentPostProcessSettings: deps.currentPostProcessSettings,
      nodeLabelOverlay: deps.nodeLabelOverlay,
      selectionController: deps.selectionController,
      getHooks: deps.getHooks,
      longViewSettleWaiters: deps.longViewSettleWaiters,
      frameStart,
      profileEnabled: deps.state.profileEnabled,
      profileFrameMs: deps.profileFrameMs,
      grassProfileEnabled: deps.grassProfileEnabled,
      grassProfileFrame,
      currentGrassStats,
      tPropsStart: terrainPhase.tPropsStart,
      tBubbleStart: terrainPhase.tBubbleStart,
      chunkGroupsBuiltThisFrame: terrainPhase.chunkGroupsBuiltThisFrame,
      nearFieldBubbleController: deps.nearFieldBubbleController,
      interaction: deps.interaction,
      makeGrassSettings: deps.makeGrassSettings,
      grassPrepassEnabled: deps.grassPrepassEnabled,
    });
  });
}

export { submitMsChanged };
