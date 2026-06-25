import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ClodHooks } from "../../core/hooks.js";
import type { ClodPagesConfig } from "../../config.js";
import type { ClodPageNode } from "../../types.js";
import type { ClodWorkerClient } from "../../clod_worker_client.js";
import { digEditCount, surfaceHeight } from "../../terrain.js";
import type { GrassStats } from "../../grass.js";
import type { StoneStats } from "../../stones/stone_instances.js";
import { formatTreeInfoLine, parseTreeConfig, type TreeStats } from "../../trees/index.js";
import { formatUnderstoryInfoLine, parseUnderstoryConfig, type UnderstoryStats } from "../../understory/index.js";
import { formatForestLightingInfoLine, type ForestLightingStats } from "../../forest_lighting/index.js";
import type { Phase0Config } from "../../phase0/phase0_config.js";
import { createClodPocGui, createClodPocTerrainMaterialGui } from "../../ui/gui/gui_root.js";
import { createProjectArchiveController } from "../../project/project_archive_controller.js";
import { createTerraformMenu } from "../../ui/terraform_menu.js";
import { createTerrainTextureModal } from "../../terrain_runtime/terrain_texture_modal.js";
import { createTerrainEditService } from "../../terrain_runtime/terrain_edit_service.js";
import { createPlayerModeController } from "../../player/player_mode_controller.js";
import { createPlayerInputController } from "../../player/player_input_controller.js";
import type { TerrainRaycastService } from "../../player/terrain_raycast_service.js";
import type { TerrainColliderSet } from "../../terrain_collider.js";
import type { PlayerController, PlayerInteractionState } from "../../player_controller.js";
import type { ProjectArchiveContents } from "../../project_archive.js";
import { bindClodFrameLoop } from "../clod_frame_loop.js";
import { updateClodOverlay, type ClodOverlaySnapshot } from "../../ui/overlay_panel.js";
import { LOD_COLORS } from "../clod_constants.js";
import type { ClodRuntimeConfig } from "../runtime_config.js";
import { resolveSlowFrameMsThreshold } from "../runtime_config.js";
import type { ClodAppState } from "../clod_app_state.js";
import type { ClodRuntimeBindings } from "../clod_runtime_bindings.js";
import { bindUiAudioShell } from "../ui_audio_shell.js";
import type { AppRenderer } from "./renderer_startup.js";
import type { TerrainViewStartupResult } from "./terrain_view_startup.js";
import type { DomShell } from "./dom_shell.js";
import type { RuntimeSystemsStartupResult, VegetationStatControllerRefs } from "./runtime_systems_startup.js";
import { type NodeView, recomputedNormalsFor } from "./bootstrap_types.js";
import type { VegetationDirtyQueue } from "../../systems/vegetation_dirty.js";

export interface UiStartupInput {
  dom: DomShell;
  searchParams: URLSearchParams;
  clodRuntime: ClodRuntimeConfig;
  cfg: ClodPagesConfig;
  WORLD: number;
  polishLine: string;
  buildStatusRef: { value: string };
  stagedImport: ProjectArchiveContents | null;
  state: ClodAppState;
  bindings: ClodRuntimeBindings;
  colorByLodUserOverride: { value: boolean };
  colorByLodController: { current: { updateDisplay: () => unknown } | null };
  terrainView: TerrainViewStartupResult;
  runtime: RuntimeSystemsStartupResult;
  statControllers: VegetationStatControllerRefs;
  app: AppRenderer;
  renderer: AppRenderer["renderer"];
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  player: PlayerController;
  interaction: PlayerInteractionState;
  terrainColliders: TerrainColliderSet;
  terrainRaycast: TerrainRaycastService;
  isWebGpu: boolean;
  worldCells: number;
  clodWorker: ClodWorkerClient;
  result: { nodesByLevel: Map<number, ClodPageNode[]> };
  allNodes: ClodPageNode[];
  maxTerrainLevel: number;
  markEditedAncestorsStale: (lod0Nodes: readonly ClodPageNode[]) => void;
  vegetationDirtyQueue: VegetationDirtyQueue;
  staleEditedAncestorIds: Set<string>;
  selectionQueryFlags: {
    queryGrassPerfScene: boolean;
    queryTreePerfScene: boolean;
    queryForestFloorScene: boolean;
  };
  longView: {
    hooks: ClodHooks | null;
    settleWaiters: { frames: number; resolve: () => void }[];
    isLongView: boolean;
    phase0TargetVisibleM: number;
    phase0Config: Phase0Config;
    queryScene: string | null;
    phase0VelocityX: number;
    phase0VelocityZ: number;
    phase0Streaming: Phase0Config["phase0"]["streaming"];
  };
  getClodErrorCompute: () => import("../../gpu/clod_error_px_compute.js").ClodErrorPxCompute | null;
  ensureClodErrorCompute: () => Promise<void>;
  textureLoadOptions: import("../../terrain_runtime/texture_loader.js").TerrainTextureLoadOptions;
  treeConfig: ReturnType<typeof parseTreeConfig>;
  understoryConfig: ReturnType<typeof parseUnderstoryConfig>;
}

export async function runUiStartup(input: UiStartupInput): Promise<void> {
  const {
    dom: {
      info,
      importButton,
      exportButton,
      projectImportInput,
      orbitModeButton,
      playerModeButton,
      playerModeStatus,
      buildProgress,
      buildProgressBar,
      buildProgressPhase,
      buildProgressPercent,
    },
    searchParams,
    clodRuntime,
    cfg,
    WORLD,
    polishLine,
    buildStatusRef,
    stagedImport,
    state,
    bindings,
    colorByLodUserOverride,
    colorByLodController,
    terrainView,
    runtime,
    statControllers,
    renderer,
    scene,
    camera,
    controls,
    player,
    interaction,
    terrainColliders,
    terrainRaycast,
    isWebGpu,
    worldCells,
    clodWorker,
    result,
    markEditedAncestorsStale,
    vegetationDirtyQueue,
    staleEditedAncestorIds,
    selectionQueryFlags: { queryGrassPerfScene, queryTreePerfScene, queryForestFloorScene },
    longView: {
      hooks: longViewHooks,
      settleWaiters: longViewSettleWaiters,
      isLongView,
      phase0TargetVisibleM,
      phase0Config,
      queryScene,
      phase0VelocityX,
      phase0VelocityZ,
      phase0Streaming,
    },
    ensureClodErrorCompute,
    textureLoadOptions,
    treeConfig,
    understoryConfig,
  } = input;

  const {
    postProcess,
    skyEnvironment,
    currentPostProcessSettings,
    materialController,
    textureController,
    applyTerrainTextures,
    applyColorByLodToMaterials,
    applyColorAdjustmentsToTerrain,
    farShellController,
    shadowProxyResult,
    lockedBorderOverlay,
    nodeLabelOverlay,
    brushPreview,
    nearFieldBubbleController,
    pageTransitionMode,
    crossfadeStep,
    selectionController,
    updateSelection,
    cutChangedRef,
    applyNodeMesh,
    views,
  } = terrainView;

  const {
    grassController,
    grassSystem,
    makeGrassSettings,
    grassStats,
    stoneController,
    stoneSystem,
    stoneStats,
    visibleStoneClasses,
    treeController,
    treeSystem,
    fallingTrees,
    treeStats,
    understoryController,
    understorySystem,
    understoryStats,
    forestLightingController,
    forestLightingSystem,
    forestLightingStats,
    applyForestLightingToPropMaterials,
    waterController,
    waterDebugState,
    makeWaterVisual,
    weatherController,
    applyWeatherSettings,
    updateWeatherStats,
    updateLighting,
    formatTreeGpuSummary,
    formatUnderstoryGpuSummary,
    drainVegetationDirtyQueue,
    onStoneScatterComplete,
  } = runtime;

  const averageFpsRef = { value: 0 };
  let lastDigSummary = "";
  let lastArchiveSummary = "";

  runtime.updateLighting();
  updateSelection();

  const setPerfModeQuery = (enabled: boolean) => {
    const next = new URLSearchParams(location.search);
    if (enabled) next.set("clodPerf", "1");
    else next.delete("clodPerf");
    history.replaceState(null, "", `${location.pathname}${next.toString() ? `?${next.toString()}` : ""}${location.hash}`);
  };
  const setWebGpuSelectionQuery = (enabled: boolean) => {
    const next = new URLSearchParams(location.search);
    if (enabled) next.set("webgpuSelection", "1");
    else next.delete("webgpuSelection");
    history.replaceState(null, "", `${location.pathname}${next.toString() ? `?${next.toString()}` : ""}${location.hash}`);
  };
  const setMaterialTiersQuery = (enabled: boolean) => {
    const next = new URLSearchParams(location.search);
    if (enabled) next.set("materialTiers", "1");
    else next.delete("materialTiers");
    history.replaceState(null, "", `${location.pathname}${next.toString() ? `?${next.toString()}` : ""}${location.hash}`);
  };
  const applyClodPerfMode = (enabled: boolean) => {
    state.clodPerfMode = enabled;
    if (enabled) {
      state.colorByLod = true;
      state.albedo = false;
      state.normalMap = false;
      state.triplanar = false;
      state.postProcessEnabled = false;
      state.postProcessDebugMode = "off";
      state.bubble = false;
      state.showBounds = false;
      state.showSeamPoints = false;
      state.showCrossLodBorders = false;
      state.showNodeLabels = false;
      state.showLockedBorderVertices = false;
      state.grassEnabled = false;
      colorByLodUserOverride.value = true;
      applyColorByLodToMaterials(true);
      nodeLabelOverlay.setVisible(false);
      lockedBorderOverlay.rebuild(selectionController.stats().renderedNodes, false);
      grassSystem?.setEnabled(false);
      postProcess?.updateSettings(currentPostProcessSettings());
      applyTerrainTextures();
    }
    skyEnvironment?.setVisible(!enabled);
    setPerfModeQuery(enabled);
    selectionController.invalidate();
    updateSelection();
    updateInfo();
  };

  let weatherStatsController: { updateDisplay: () => unknown } | null = null;
  let grassBladeCountController: { updateDisplay: () => unknown } | null = null;
  let grassVisiblePatchesController: { updateDisplay: () => unknown } | null = null;
  let grassTierSummaryController: { updateDisplay: () => unknown } | null = null;
  let grassEdgeSuppressedController: { updateDisplay: () => unknown } | null = null;
  let grassCandidateCountController: { updateDisplay: () => unknown } | null = null;

  waterController.installDebugApi({
    exitToOrbit: () => interaction.exitToOrbit(),
    resetPlayerInput: () => bindings.resetPlayerInput(),
    setControlsEnabled: (enabled) => { controls.enabled = enabled; },
    setControlsTarget: (x, y, z) => { controls.target.set(x, y, z); },
    setCameraPosition: (x, y, z) => { camera.position.set(x, y, z); },
    cameraLookAt: (x, y, z) => { camera.lookAt(x, y, z); },
    controlsUpdate: () => { controls.update(); },
    updatePlayerModeUi: () => bindings.updatePlayerModeUi(),
    updateSelection: () => updateSelection(),
    setWaterDebugModeState: (mode) => { state.waterDebugMode = mode; },
  });

  let pendingParentNodes = 0;
  let pendingParentMs = 0;
  let pendingParentCount = 0;

  const currentOverlaySnapshot = (): ClodOverlaySnapshot => {
    const selection = selectionController.stats();
    return {
      worldSize: WORLD,
      renderedTriangles: selection.triCount,
      nodesByLod: selection.nodesByLod,
      forcedSplits: selection.forcedSplits,
      bubbleForcedSplits: selection.nearFieldForcedSplits,
      cutFrozen: state.freeze,
      errorThreshold: state.thresholdPx,
      buildStatus: buildStatusRef.value,
      digCostLine: lastDigSummary || undefined,
      polishLine,
    };
  };

  const updateInfo = () => {
    const selection = selectionController.stats();
    const playerLine = interaction.mode === "playing"
      ? `player: grounded=${player.grounded}  physics p95=${player.physicsP95Ms().toFixed(2)} ms  collider pages=${player.lastPagesTested}`
      : `view: ${interaction.mode}`;
    const sceneLabel = queryGrassPerfScene ? "  GRASS PERF" : queryTreePerfScene ? "  TREE PERF" : queryForestFloorScene ? "  FOREST FLOOR" : "";
    info.textContent =
      `Drusniel Voxels Web — ${WORLD}x${WORLD} pages${sceneLabel}\n` +
      `cut: ${selection.renderedCount} nodes  (${selection.levelSummary})\n` +
      `tris rendered: ${selection.triCount.toLocaleString()}   2:1 forced splits: ${selection.forcedSplits}   ` +
      `bubble forced splits: ${selection.nearFieldForcedSplits}   xLOD borders: ${selection.crossLodAdjacencyCount}\n` +
      `threshold: ${state.thresholdPx.toFixed(2)} px   avg FPS: ${averageFpsRef.value.toFixed(1)}   ` +
      `${state.forceMaxLevel === "auto" ? "" : `forced<=${state.forceMaxLevel}   `}${state.freeze ? "[FROZEN]" : ""}\n` +
      `renderer: ${isWebGpu ? "WebGPU" : "WebGL"}   selection: ${selection.selectionSource} ${selection.selectionMs.toFixed(2)}ms   gpu-compute: ${selectionController.formatWebGpuStats(state.webgpuSelection)}\n` +
      `${polishLine}\n` +
      `worker: parents pending=${pendingParentCount} rebuilt=${pendingParentNodes} ${pendingParentMs.toFixed(0)}ms   ` +
      `colliders loaded=${terrainColliders.loadedPageCount()}${state.clodPerfMode ? "   CLOD PERF" : ""}\n` +
      `grass: ${state.grassEnabled ? "enabled" : "disabled"} ${state.grassShaderMode} ` +
      `${state.grassBladeCount.toLocaleString()} blades` +
      `${grassStats.current ? ` patches=${grassStats.current.visiblePatches}/${grassStats.current.patches} ` +
      `tiers n/m/f/s=${grassStats.current.nearPatches}/${grassStats.current.midPatches}/${grassStats.current.coveragePatches}/${grassStats.current.superPatches} ` +
      `edge-skip=${grassStats.current.edgeSuppressedCandidates} rebuilds=${grassStats.current.patchRebuildCount} build=${grassStats.current.buildMs.toFixed(1)}ms` : ""}` +
      `${grassStats.current && grassStats.current.gpuRingStatus !== "disabled"
        ? ` gpu-grass=${grassStats.current.gpuRingStatus}` +
          ` gpu-n/m/f/s=${grassStats.current.gpuRingVisibleNear}/${grassStats.current.gpuRingVisibleMid}/${grassStats.current.gpuRingVisibleFar}/${grassStats.current.gpuRingVisibleSuper}` +
          ` gpu-dispatch=${grassStats.current.gpuRingDispatchMs === null ? "-" : grassStats.current.gpuRingDispatchMs.toFixed(2)}ms`
        : grassStats.current ? ` gpu-grass=${grassStats.current.gpuRingStatus}` : ""}\n` +
      `${formatTreeInfoLine(state.treesEnabled, state.treeTotal, treeStats.current)}\n` +
      `${formatUnderstoryInfoLine(state.understoryEnabled, state.understoryTotal, understoryStats.current)}\n` +
      `${formatForestLightingInfoLine(state.forestLightingEnabled, forestLightingStats.current)}\n` +
      `brush: ${state.digEnabled ? "on" : "off"}  ${state.brushOp === "add" ? "raise" : "dig"} ${state.brushShape} r=${state.digRadius}  edits=${digEditCount()}\n` +
      `${lastDigSummary ? `last: ${lastDigSummary}\n` : ""}` +
      `${lastArchiveSummary ? `${lastArchiveSummary}\n` : ""}` +
      playerLine;
    updateClodOverlay(currentOverlaySnapshot());
  };
  cutChangedRef.fn = updateInfo;

  clodWorker.onParentRebuilt = (batch) => {
    for (const node of batch.changed) {
      applyNodeMesh(node);
      staleEditedAncestorIds.delete(node.id);
    }
    selectionController.patchNodes(batch.changed);
    pendingParentNodes = batch.parentNodes;
    pendingParentMs = batch.parentMs;
    pendingParentCount = batch.pendingParents;
    selectionController.invalidate();
    if (!state.freeze) updateSelection();
    updateInfo();
  };
  clodWorker.onParentsComplete = (_requestId, parentNodes, parentMs) => {
    pendingParentNodes = parentNodes;
    pendingParentMs = parentMs;
    pendingParentCount = 0;
    staleEditedAncestorIds.clear();
    if (parentNodes > 0) {
      lastDigSummary = `${lastDigSummary} + ancestors ${parentNodes}n ${parentMs.toFixed(0)}ms`;
    }
    updateSelection();
    updateInfo();
  };

  let terraformEditCheckbox: HTMLInputElement | null = null;
  const playerTerraformEditActive = () => terraformEditCheckbox?.checked ?? false;

  const terrainEditService = createTerrainEditService({
    clodWorker,
    terrainRaycast,
    getBrushParams: () => ({
      digRadius: state.digRadius,
      brushShape: state.brushShape,
      brushOp: state.brushOp,
      brushMaterial: state.brushMaterial,
      brushHeight: state.brushHeight,
      brushStrength: state.brushStrength,
      brushFalloff: state.brushFalloff,
    }),
    getVegetationState: () => ({
      grassEnabled: state.grassEnabled,
      treesEnabled: state.treesEnabled,
      understoryEnabled: state.understoryEnabled,
    }),
    applyNodeMesh,
    markEditedAncestorsStale,
    selectionController,
    applyTerrainTextures,
    grassSystem,
    treeSystem,
    understorySystem,
    vegetationDirtyQueue,
    fallingTrees,
    refreshGrassStats: bindings.refreshGrassStats,
    refreshTreeStats: bindings.refreshTreeStats,
    refreshUnderstoryStats: bindings.refreshUnderstoryStats,
    updateInfo,
    getLastDigSummary: () => lastDigSummary,
    setLastDigSummary: (summary) => { lastDigSummary = summary; },
    setPendingParentCount: (count) => { pendingParentCount = count; },
    setPendingParentNodes: (nodes) => { pendingParentNodes = nodes; },
    setPendingParentMs: (ms) => { pendingParentMs = ms; },
  });
  const flushAncestors = () => terrainEditService.flushAncestors();
  const scheduleDig = (ray: THREE.Ray) => terrainEditService.scheduleDig(ray);

  let playerModeController!: ReturnType<typeof createPlayerModeController>;
  let playerInputController!: ReturnType<typeof createPlayerInputController>;
  let digRadiusController!: { updateDisplay: () => unknown };

  const wirePlayerControllers = () => {
    playerInputController = createPlayerInputController({
      renderer,
      camera,
      controls,
      player,
      interaction,
      getDigEnabled: () => state.digEnabled,
      getTerraformEditActive: playerTerraformEditActive,
      getBrushFlowMs: () => state.brushFlowMs,
      scheduleDig,
      getLastDigAt: () => terrainEditService.lastDigAt,
      onTabUiHoldChange: () => { playerModeController.updatePlayerModeUi(); },
      onPlayerModeUiChange: () => { playerModeController.updatePlayerModeUi(); },
      exitPlayerMode: () => playerModeController.exitPlayerMode(),
      adjustDigRadius: (delta) => {
        state.digRadius = THREE.MathUtils.clamp(state.digRadius - Math.sign(delta) * 0.5, 1, 8);
        digRadiusController.updateDisplay();
        bindings.syncTerraformMenu();
        updateInfo();
      },
    });
    playerModeController = createPlayerModeController({
      renderer,
      camera,
      controls,
      player,
      interaction,
      terrainColliders,
      surfaceHeight,
      orbitModeButton,
      playerModeButton,
      playerModeStatus,
      searchParams,
      getTerraformEditActive: playerTerraformEditActive,
      getTabUiHold: () => playerInputController.tabUiHold,
      onBeforeExitMode: () => playerInputController.onBeforeExitMode(),
      resetPlayerInput: () => playerInputController.resetPlayerInput(),
      onStartPlayingFacing: (yaw, pitch) => playerInputController.setPlayerYawPitch(yaw, pitch),
    });
    bindings.resetPlayerInput = () => playerInputController.resetPlayerInput();
    bindings.updatePlayerModeUi = () => playerModeController.updatePlayerModeUi();
    playerModeController.applyQuerySpawn();
    playerModeController.updatePlayerModeUi();
  };

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
      setMaterialTiersQuery,
      setWebGpuSelectionQuery,
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
  const gui = guiResult.gui;
  colorByLodController.current = guiResult.colorByLodController;
  weatherStatsController = guiResult.weatherStatsController;
  bindings.refreshGrassStats = guiResult.refreshGrassStats;
  bindings.refreshTreeStats = guiResult.refreshTreeStats;
  bindings.refreshUnderstoryStats = guiResult.refreshUnderstoryStats;
  onStoneScatterComplete.current = guiResult.onStoneScatterComplete;
  statControllers.forestLightingStats = guiResult.forestLightingStatsController;
  ({
    grassBladeCount: grassBladeCountController,
    grassVisiblePatches: grassVisiblePatchesController,
    grassTierSummary: grassTierSummaryController,
    grassEdgeSuppressed: grassEdgeSuppressedController,
    grassCandidateCount: grassCandidateCountController,
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

  const textureProgress = {
    setPhase: (label: string, fraction: number) => {
      buildProgress.hidden = false;
      buildProgressPhase.textContent = label;
      buildProgressPercent.textContent = `${Math.round(fraction * 100)}%`;
      buildProgressBar.value = fraction;
    },
  };
  const textureModal = createTerrainTextureModal({
    textureController,
    textureLoadOptions,
    applyTerrainTextures,
    setLoadedTextureFiles: (value) => {
      state.loadedTextureFiles = value;
    },
    onBrushMaterialClamped: (maxIndex) => {
      if (state.brushMaterial > maxIndex) state.brushMaterial = 0;
    },
  });
  if (stagedImport) {
    textureModal.rebuildTextureSlotCards();
    await textureController.restoreStagedImport(textureProgress);
  } else if (!state.clodPerfMode && state.terrainMaterialSource === "external_pbr") {
    await textureController.loadDefaultBuiltinTextures(textureProgress);
  } else {
    state.loadedTextureFiles = state.clodPerfMode ? "perf mode" : state.terrainMaterialSource;
  }
  textureModal.syncTextureModalControls();
  textureModal.updateTextureSlotPreviews();
  textureModal.refreshTextureState();
  buildProgress.hidden = true;

  const { digRadiusController: digRadiusGuiController } = createClodPocTerrainMaterialGui(gui, state, {
    terrainMaterial: {
      textureModal,
      applyTerrainTextures,
      updateSelection,
      updateInfo,
      applyBubbleTint: (enabled) => nearFieldBubbleController.applyTint(enabled),
    },
  });
  digRadiusController = digRadiusGuiController;

  wirePlayerControllers();

  const terraformMenuRoot = document.getElementById("terraform-menu")!;
  const terraformMenuUi = createTerraformMenu({
    root: terraformMenuRoot,
    state,
    materialController,
    digRadiusController,
    updateInfo,
    bindTerraformEditCheckbox: (input) => playerModeController.bindTerraformEditCheckbox(input),
    bindEditToggleInput: (input) => playerModeController.bindEditToggleInput(input),
    onEditToggleChanged: (enabled) => {
      if (!enabled) {
        playerInputController.clearDigHold();
        brushPreview.hide();
      }
      playerModeController.updatePlayerModeUi();
    },
  });
  terraformEditCheckbox = terraformMenuUi.editCheckbox;
  bindings.refreshTerraformSwatches = terraformMenuUi.refreshSwatches;
  bindings.syncTerraformMenu = terraformMenuUi.syncMenu;

  const projectArchiveController = createProjectArchiveController({
    importButton,
    exportButton,
    projectImportInput,
    buildProgress,
    buildProgressPhase,
    buildProgressPercent,
    buildProgressBar,
    getState: () => state,
    getWorldSize: () => WORLD,
    getConfig: () => cfg,
    getNodesByLevel: () => result.nodesByLevel,
    textureController,
    camera,
    controls,
    flushAncestors,
    setBuildStatus: (status) => { buildStatusRef.value = status; },
    updateOverlay: () => updateClodOverlay(currentOverlaySnapshot()),
    setLastArchiveSummary: (summary) => { lastArchiveSummary = summary; },
    updateInfo,
  });
  projectArchiveController.bindImportExportButtons();

  materialController.forEachMaterial((material) => {
    material.setWireframe(state.wireframe);
    material.setDebug({
      normalColor: state.normalColor,
      normalDivergence: state.normalDivergence,
      divergenceGain: state.divergenceGain,
    });
    material.setSide(state.frontSideOnly ? THREE.FrontSide : THREE.DoubleSide);
  });
  for (const view of views.values()) {
    view.mat.setBaseColor(state.colorByLod ? LOD_COLORS[Math.min(view.node.level, 3)] : 0xb9c0c8);
    if (state.recomputedNormals) {
      view.mesh.geometry.setAttribute("normal", new THREE.BufferAttribute(recomputedNormalsFor(view), 3));
    }
  }
  applyColorAdjustmentsToTerrain();
  updateLighting();
  applyTerrainTextures();
  grassSystem?.setEnabled(state.grassEnabled);
  grassSystem?.updateSettings(makeGrassSettings());
  bindings.refreshGrassStats();
  treeSystem.setEnabled(state.treesEnabled);
  treeController.applySettings();
  bindings.refreshTreeStats();
  understorySystem.setEnabled(state.understoryEnabled);
  understoryController.applySettings();
  bindings.refreshUnderstoryStats();
  forestLightingController.bumpSettingsVersion();
  forestLightingController.applySettings();
  updateSelection();
  updateInfo();

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
    renderer: renderer as THREE.WebGLRenderer,
    scene,
    camera,
    controls,
    player,
    interaction,
    state,
    selectionController,
    playerInputController,
    skyEnvironment,
    drainVegetationDirtyQueue,
    treeController,
    updateSelection,
    playerTerraformEditActive,
    brushPreview,
    terrainRaycast,
    pageTransitionMode,
    crossfadeStep,
    nearFieldBubbleController,
    views,
    worldCells,
    grassController,
    understoryController,
    forestLightingController,
    applyForestLightingToPropMaterials,
    stoneController,
    waterController,
    weatherController,
    updateWeatherStats,
    weatherStatsController,
    grassSystem,
    treeSystem,
    understorySystem,
    forestLightingSystem,
    stoneSystem,
    currentLighting: terrainView.currentLighting,
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
    grassBladeCountController,
    grassVisiblePatchesController,
    grassTierSummaryController,
    grassEdgeSuppressedController,
    grassCandidateCountController,
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
    nodeLabelOverlay,
    postProcess,
    currentPostProcessSettings,
    makeGrassSettings,
    updateInfo,
    averageFpsRef,
    getHooks: () => longViewHooks,
    longViewSettleWaiters,
    maxTerrainLevel: input.maxTerrainLevel,
    farShellBuilt: () => farShellController.isBuilt(),
    farShellCanopyEnabled: () => farShellController.canopyShell !== null,
    isLongView,
    phase0TargetVisibleM,
    phase0Config,
    queryScene,
    phase0VelocityX,
    phase0VelocityZ,
    phase0Streaming,
    longViewDiagnosticsCfg: cfg,
    getFarShellRadiusFactor: () => state.farShellRadiusFactor,
    profileFrameMs,
    grassProfileEnabled,
    grassPrepassEnabled,
  });

  bindUiAudioShell();

  window.addEventListener("beforeunload", () => {
    nearFieldBubbleController.dispose();
    lockedBorderOverlay.dispose();
    grassSystem.dispose();
    forestLightingController.dispose();
    treeController.dispose();
    stoneSystem.dispose();
    waterController.dispose();
    weatherController.dispose();
    skyEnvironment?.dispose();
    postProcess?.dispose();
    input.getClodErrorCompute()?.destroy();
    clodWorker.dispose();
    farShellController.dispose();
    shadowProxyResult.dispose();
  }, { once: true });
}
