import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ClodHooks } from "../core/hooks.js";
import type { GrassStats, GrassSettings } from "../grass.js";
import type { StoneStats } from "../stones/stone_instances.js";
import type { TreeTotalDisplay } from "../trees/tree_info.js";
import { formatTreeTotalDisplay, type TreeStats } from "../trees/index.js";
import type { UnderstoryStats } from "../understory/index.js";
import type { ForestLightingStats } from "../forest_lighting/index.js";
import type { PostProcessSettings } from "../postprocess.js";
import type { BrushOp, BrushShape } from "../terrain.js";
import type { ClodSelectionController } from "../terrain_runtime/clod_selection_controller.js";
import type { NearFieldBubbleController, NearFieldBubbleView } from "../terrain_runtime/near_field_bubble_controller.js";
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

export interface ClodFrameLoopUiState {
  freeze: boolean;
  bubble: boolean;
  bubbleRadius: number;
  digEnabled: boolean;
  brushShape: BrushShape;
  brushOp: BrushOp;
  digRadius: number;
  brushHeight: number;
  weatherMode: string;
  profileEnabled: boolean;
  grassBladeCount: number;
  grassVisiblePatches: string;
  grassTierSummary: string;
  grassEdgeSuppressed: number;
  grassCandidateCount: number;
  treeTotal: TreeTotalDisplay;
  treeVisiblePatches: string;
  treeLodSummary: string;
  treeGpuSummary: string;
  stoneTotal: number;
  stoneClassSummary: string;
  stoneVisible: number;
  understoryTotal: number;
  understoryVisiblePatches: string;
  understoryClassSummary: string;
  understoryGpuSummary: string;
  forestLightingStats: string;
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
  submitMsChanged: (a: number | null, b: number | null) => boolean;
}

const submitMsChanged = (a: number | null, b: number | null): boolean =>
  a === b ? false : a === null || b === null ? true : Math.abs(a - b) >= 0.05;

export function bindClodFrameLoop(deps: ClodFrameLoopDeps): void {
  let elapsedSeconds = 0;
  const averageFpsRef = deps.averageFpsRef;
  const fpsSamples: number[] = [];
  let lastFrameAt = performance.now();
  let lastFpsRefreshAt = lastFrameAt;
  let grassProfileFrame = 0;

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

  const grassProfileMs = (value: number | null): string => value === null ? "-" : `${value.toFixed(2)}ms`;
  const logGrassProfile = (stats: GrassStats, grassAndPropsMs: number): void => {
    if (!deps.grassProfileEnabled) return;
    const settings = deps.makeGrassSettings();
    const visible = stats.gpuRingVisibleNear
      + stats.gpuRingVisibleMid
      + stats.gpuRingVisibleFar
      + stats.gpuRingVisibleSuper;
    // eslint-disable-next-line no-console
    console.info(
      `[grass-profile] mode=${stats.mode}` +
        ` dispatch=${grassProfileMs(stats.gpuRingDispatchMs)}` +
        ` readback=${grassProfileMs(stats.gpuRingReadbackMs)}` +
        ` visible=${visible}` +
        ` near=${stats.gpuRingVisibleNear}` +
        ` mid=${stats.gpuRingVisibleMid}` +
        ` far=${stats.gpuRingVisibleFar}` +
        ` super=${stats.gpuRingVisibleSuper}` +
        ` prepass=${deps.grassPrepassEnabled ? "on" : "off"}` +
        ` grid=${settings.ring.grid}` +
        ` cell=${settings.ring.cell}` +
        ` slots=${settings.ring.grid * settings.ring.grid}` +
        ` grass+props=${grassAndPropsMs.toFixed(2)}ms`,
    );
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
    const activeTerrainViews = deps.selectionController.activeTerrainViews() as Set<TerrainFadeView>;
    const currentTerrainViews = deps.selectionController.currentTerrainViews();
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

    for (const v of activeTerrainViews) {
      if (deps.pageTransitionMode === "instant") {
        v.fade = v.target;
        v.mesh.visible = v.target > 0.5;
        v.mat.setFade(1, v.target > 0.5, false);
        activeTerrainViews.delete(v);
        continue;
      }

      if (v.fade < v.target) v.fade = Math.min(v.target, v.fade + deps.crossfadeStep);
      else if (v.fade > v.target) v.fade = Math.max(v.target, v.fade - deps.crossfadeStep);
      v.mesh.visible = v.fade > 0.001;
      v.mat.setFade(v.fade, v.target > 0.5, v.fade > 0.001 && v.fade < 0.999);
      if (v.fade === v.target) activeTerrainViews.delete(v);
    }

    const bubbleCenter = deps.interaction.mode === "playing" ? deps.player.position : deps.controls.target;
    const bubbleStats = deps.nearFieldBubbleController.update({
      enabled: deps.state.bubble,
      bubbleRadius: deps.state.bubbleRadius,
      bubbleCenter,
      bubbleViews: new Set([...currentTerrainViews, ...activeTerrainViews]) as unknown as Set<NearFieldBubbleView>,
      getView: (nodeId) => deps.views.get(nodeId) as unknown as NearFieldBubbleView | undefined,
      frameId: selectionStats.frameId,
    });
    const chunkGroupsBuiltThisFrame = bubbleStats.chunkGroupsBuiltThisFrame;
    const tBubbleStart = performance.now() - bubbleStats.bubbleMs;
    const tPropsStart = performance.now();
    const grassCenter = deps.interaction.mode === "playing" ? deps.player.position : deps.controls.target;
    const ringClampMargin = 2;
    const ringCenter = new THREE.Vector3(
      THREE.MathUtils.clamp(grassCenter.x, ringClampMargin, deps.worldCells - ringClampMargin),
      grassCenter.y,
      THREE.MathUtils.clamp(grassCenter.z, ringClampMargin, deps.worldCells - ringClampMargin),
    );
    deps.grassController.update(elapsedSeconds, ringCenter, deps.camera);
    deps.treeController.update(elapsedSeconds, ringCenter, deps.camera);
    deps.understoryController.update(elapsedSeconds, ringCenter, deps.camera);
    deps.forestLightingController.update(elapsedSeconds, grassCenter, {
      treeProxies: deps.treeSystem.getLightingProxies(),
      understoryProxies: deps.understorySystem.getLightingProxies(),
      sunDirection: deps.currentLighting().sunDirection,
    });
    deps.applyForestLightingToPropMaterials();
    deps.stoneController.update(ringCenter);
    deps.waterController.update(Math.min(playerDelta, 0.1), deps.camera.position);
    deps.weatherController.update(playerDelta, elapsedSeconds, deps.camera.position, grassCenter);
    if (deps.state.weatherMode !== "off" && selectionStats.frameId % 30 === 0) {
      deps.updateWeatherStats();
      deps.weatherStatsController?.updateDisplay();
    }
    deps.waterController.logDevInitOnce(deps.worldCells);

    const nextTreeStats = deps.treeSystem?.getStats();
    const treeStats = deps.getTreeStats();
    if (
      nextTreeStats && (
      !treeStats ||
      nextTreeStats.totalTrees !== treeStats.totalTrees ||
      nextTreeStats.visiblePatches !== treeStats.visiblePatches ||
      nextTreeStats.patches !== treeStats.patches ||
      nextTreeStats.nearTrees !== treeStats.nearTrees ||
      nextTreeStats.midTrees !== treeStats.midTrees ||
      nextTreeStats.farTrees !== treeStats.farTrees ||
      nextTreeStats.impostorTrees !== treeStats.impostorTrees ||
      nextTreeStats.gpuStatus !== treeStats.gpuStatus ||
      nextTreeStats.gpuCandidateCount !== treeStats.gpuCandidateCount ||
      nextTreeStats.gpuAcceptedCount !== treeStats.gpuAcceptedCount ||
      nextTreeStats.gpuVisibleCount !== treeStats.gpuVisibleCount ||
      nextTreeStats.gpuOverflowed !== treeStats.gpuOverflowed)
    ) {
      deps.setTreeStats(nextTreeStats);
      deps.state.treeTotal = formatTreeTotalDisplay(nextTreeStats);
      deps.state.treeVisiblePatches = `${nextTreeStats.visiblePatches}/${nextTreeStats.patches}`;
      deps.state.treeLodSummary = `${nextTreeStats.nearTrees}/${nextTreeStats.midTrees}/${nextTreeStats.farTrees}/${nextTreeStats.impostorTrees}`;
      deps.state.treeGpuSummary = deps.formatTreeGpuSummary(nextTreeStats);
      deps.treeTotalController?.updateDisplay();
      deps.treeVisiblePatchesController?.updateDisplay();
      deps.treeLodSummaryController?.updateDisplay();
      deps.treeGpuSummaryController?.updateDisplay();
    }

    const nextStoneStats = deps.stoneSystem?.getStats();
    const stoneStats = deps.getStoneStats();
    if (nextStoneStats && (!stoneStats || nextStoneStats.total !== stoneStats.total || nextStoneStats.visible !== stoneStats.visible)) {
      deps.setStoneStats(nextStoneStats);
      deps.state.stoneTotal = nextStoneStats.total;
      deps.state.stoneClassSummary = `${nextStoneStats.large}/${nextStoneStats.medium}/${nextStoneStats.small}`;
      deps.state.stoneVisible = nextStoneStats.visible;
      deps.stoneTotalController?.updateDisplay();
      deps.stoneClassSummaryController?.updateDisplay();
      deps.stoneVisibleController?.updateDisplay();
    }

    const nextUnderstoryStats = deps.understorySystem?.getStats();
    const understoryStats = deps.getUnderstoryStats();
    if (
      nextUnderstoryStats && (
      !understoryStats ||
      nextUnderstoryStats.totalInstances !== understoryStats.totalInstances ||
      nextUnderstoryStats.visiblePatches !== understoryStats.visiblePatches ||
      nextUnderstoryStats.patches !== understoryStats.patches ||
      nextUnderstoryStats.gpuStatus !== understoryStats.gpuStatus ||
      nextUnderstoryStats.gpuVisibleCount !== understoryStats.gpuVisibleCount ||
      nextUnderstoryStats.gpuCandidateCount !== understoryStats.gpuCandidateCount ||
      nextUnderstoryStats.gpuAcceptedCount !== understoryStats.gpuAcceptedCount ||
      nextUnderstoryStats.gpuOverflowed !== understoryStats.gpuOverflowed ||
      deps.submitMsChanged(nextUnderstoryStats.gpuDispatchMs, understoryStats.gpuDispatchMs))
    ) {
      deps.setUnderstoryStats(nextUnderstoryStats);
      deps.state.understoryTotal = nextUnderstoryStats.totalInstances;
      deps.state.understoryVisiblePatches = `${nextUnderstoryStats.visiblePatches}/${nextUnderstoryStats.patches}`;
      deps.state.understoryClassSummary =
        `${nextUnderstoryStats.shrub}/${nextUnderstoryStats.fern}/${nextUnderstoryStats.sapling}/${nextUnderstoryStats.flower}/${nextUnderstoryStats.deadLog}/${nextUnderstoryStats.stump}`;
      deps.state.understoryGpuSummary = deps.formatUnderstoryGpuSummary(nextUnderstoryStats);
      deps.understoryTotalController?.updateDisplay();
      deps.understoryVisiblePatchesController?.updateDisplay();
      deps.understoryClassSummaryController?.updateDisplay();
      deps.understoryGpuSummaryController?.updateDisplay();
    }

    const nextForestLightingStats = deps.forestLightingSystem.getStats();
    const forestLightingStats = deps.getForestLightingStats();
    if (
      !forestLightingStats ||
      nextForestLightingStats.textureUpdates !== forestLightingStats.textureUpdates ||
      nextForestLightingStats.enabled !== forestLightingStats.enabled ||
      nextForestLightingStats.treeProxies !== forestLightingStats.treeProxies ||
      nextForestLightingStats.understoryProxies !== forestLightingStats.understoryProxies
    ) {
      deps.setForestLightingStats(nextForestLightingStats);
      deps.state.forestLightingStats = nextForestLightingStats.enabled
        ? `canopy=${nextForestLightingStats.maxCanopy.toFixed(2)} ao=${nextForestLightingStats.maxAo.toFixed(2)} ` +
          `shadow=${nextForestLightingStats.maxShadow.toFixed(2)} fog=${nextForestLightingStats.maxFog.toFixed(2)}`
        : "disabled";
      deps.forestLightingStatsController?.updateDisplay();
    }

    const nextGrassStats = deps.grassSystem?.getStats();
    const grassStats = deps.getGrassStats();
    if (
      nextGrassStats && (
      !grassStats ||
      nextGrassStats.blades !== grassStats.blades ||
      nextGrassStats.visiblePatches !== grassStats.visiblePatches ||
      nextGrassStats.patches !== grassStats.patches ||
      nextGrassStats.nearPatches !== grassStats.nearPatches ||
      nextGrassStats.midPatches !== grassStats.midPatches ||
      nextGrassStats.coveragePatches !== grassStats.coveragePatches ||
      nextGrassStats.superPatches !== grassStats.superPatches ||
      nextGrassStats.gpuRingStatus !== grassStats.gpuRingStatus ||
      nextGrassStats.gpuRingVisibleNear !== grassStats.gpuRingVisibleNear ||
      nextGrassStats.gpuRingVisibleMid !== grassStats.gpuRingVisibleMid ||
      nextGrassStats.gpuRingVisibleFar !== grassStats.gpuRingVisibleFar ||
      nextGrassStats.gpuRingVisibleSuper !== grassStats.gpuRingVisibleSuper ||
      nextGrassStats.edgeSuppressedCandidates !== grassStats.edgeSuppressedCandidates ||
      nextGrassStats.generatedCandidates !== grassStats.generatedCandidates)
    ) {
      deps.setGrassStats(nextGrassStats);
      deps.state.grassBladeCount = nextGrassStats.blades;
      deps.state.grassVisiblePatches = `${nextGrassStats.visiblePatches}/${nextGrassStats.patches}`;
      deps.state.grassTierSummary = `${nextGrassStats.nearPatches}/${nextGrassStats.midPatches}/${nextGrassStats.coveragePatches}/${nextGrassStats.superPatches}`;
      deps.state.grassEdgeSuppressed = nextGrassStats.edgeSuppressedCandidates;
      deps.state.grassCandidateCount = nextGrassStats.generatedCandidates;
      deps.grassBladeCountController?.updateDisplay();
      deps.grassVisiblePatchesController?.updateDisplay();
      deps.grassTierSummaryController?.updateDisplay();
      deps.grassEdgeSuppressedController?.updateDisplay();
      deps.grassCandidateCountController?.updateDisplay();
    }
    const currentGrassStats = nextGrassStats ?? grassStats;

    deps.nodeLabelOverlay.update({
      nodes: selectionStats.renderedNodes,
      camera: deps.camera,
      viewport: deps.renderer.domElement,
      viewportHeight: deps.renderer.domElement.height,
      fovY: THREE.MathUtils.degToRad(deps.camera.fov),
    });
    deps.postProcess?.updateSettings(deps.currentPostProcessSettings());
    const tRenderStart = performance.now();
    if (deps.grassProfileEnabled && currentGrassStats && grassProfileFrame++ % 60 === 0) {
      logGrassProfile(currentGrassStats, tRenderStart - tPropsStart);
    }
    if (deps.postProcess) deps.postProcess.render(deps.scene, deps.camera);
    else deps.renderer.render(deps.scene, deps.camera);

    const hooks = deps.getHooks();
    if (hooks && !hooks.ready) {
      hooks.ready = true;
      hooks.progress = 1;
      hooks.progressMsg = "ready";
    }

    for (const waiter of deps.longViewSettleWaiters) waiter.frames -= 1;
    const doneWaiters = deps.longViewSettleWaiters.filter((w) => w.frames <= 0);
    for (const waiter of doneWaiters) waiter.resolve();
    for (const waiter of doneWaiters) deps.longViewSettleWaiters.splice(deps.longViewSettleWaiters.indexOf(waiter), 1);

    if (deps.state.profileEnabled) {
      const end = performance.now();
      const frameMs = end - frameStart;
      if (frameMs >= deps.profileFrameMs) {
        const bubbleMs = tPropsStart - tBubbleStart;
        const propsMs = tRenderStart - tPropsStart;
        const renderMs = end - tRenderStart;
        const otherMs = frameMs - selectionStats.selectionMs - bubbleMs - propsMs - renderMs;
        // eslint-disable-next-line no-console
        console.warn(
          `[profile] frame ${frameMs.toFixed(1)}ms` +
            ` | selection ${selectionStats.selectionMs.toFixed(1)}` +
            ` (cut ${selectionStats.subphases.cut.toFixed(1)} book ${selectionStats.subphases.book.toFixed(1)} info ${selectionStats.subphases.info.toFixed(1)} overlays ${selectionStats.subphases.overlays.toFixed(1)})` +
            ` bubble/chunks ${bubbleMs.toFixed(1)} (built ${chunkGroupsBuiltThisFrame})` +
            ` props ${propsMs.toFixed(1)}` +
            ` render ${renderMs.toFixed(1)}` +
            ` other ${otherMs.toFixed(1)}` +
            ` | cut=${selectionStats.renderedCount} chunkGroups=${deps.nearFieldBubbleController.size()} mode=${deps.interaction.mode}`,
        );
      }
    }
  });
}

export { submitMsChanged };
