import { digEditCount } from "../../terrain/terrain.js";
import {
  formatTreeGpuFallbackWarning,
  formatTreeGpuOverlayStatus,
  formatTreeInfoLine,
} from "../../trees/index.js";
import { formatUnderstoryInfoLine } from "../../understory/index.js";
import { formatForestLightingInfoLine } from "../../forest_lighting/index.js";
import { updateClodOverlay, type ClodOverlaySnapshot } from "../../ui/overlay_panel.js";
import { createStreamDiagnosticTracker } from "../../stream/stream_diagnostics.js";
import { TERRAIN_SOURCE_VERSION } from "../../cache/terrainSource.js";
import type { UiStartupContext } from "./ui_startup_context.js";

/**
 * Compact world-identity diagnostics line. Surfaces the WorldMode struct, the finite/infinite
 * decision, the active far owner, live streamed-root safety coverage, and the cache-source
 * version so the exact class of bug that flattened terrain far from the startup world is visible
 * at a glance instead of hidden in global state.
 */
function formatWorldModeLine(cameraX: number, cameraZ: number): string {
  const world = window.__drusnielWorldMode;
  const counters = window.__drusnielClod?.stats?.counters ?? {};
  const safetyReady = counters["live_clod_stream_safety_ready_pages"] ?? 0;
  const safetyRequired = counters["live_clod_stream_safety_required_pages"] ?? 0;
  const activeRoots = counters["live_clod_stream_active_root_pages"] ?? 0;
  const center = `player=(${cameraX.toFixed(0)}, ${cameraZ.toFixed(0)})`;
  if (!world) return `world: (mode pending)   ${center}   cache=${TERRAIN_SOURCE_VERSION}`;
  const radius = world.proceduralWorldRadiusM ? `${world.proceduralWorldRadiusM}m` : "inf";
  return (
    `world: ${world.mode}   cfg=${world.configuredWorldPages}p boot=${world.startupWorldPages}p ` +
    `(cells cfg=${world.configuredWorldCells}/boot=${world.startupWorldCells})   radius=${radius}   ` +
    `coast=${world.borderCoastEnabled ? "on" : "off"}   far=${world.farOwner}   ` +
    `${center}   safety=${safetyReady}/${safetyRequired} roots=${activeRoots}   cache=${TERRAIN_SOURCE_VERSION}`
  );
}

export interface InfoPanelController {
  updateInfo: () => void;
  currentOverlaySnapshot: () => ClodOverlaySnapshot;
  applyClodPerfMode: (enabled: boolean) => void;
}

export function createInfoPanelController(ctx: UiStartupContext): InfoPanelController {
  const { input, session } = ctx;
  const {
    dom: { info, infoPanel },
    WORLD,
    polishLine,
    buildStatusRef,
    state,
    isWebGpu,
    terrainColliders,
    clodWorker,
    selectionQueryFlags: { queryGrassPerfScene, queryTreePerfScene, queryForestFloorScene },
    player,
    interaction,
  } = input;
  const {
    postProcess,
    skyEnvironment,
    currentPostProcessSettings,
    applyColorByLodToMaterials,
    applyTerrainTextures,
    lockedBorderOverlay,
    nodeLabelOverlay,
    selectionController,
    updateSelection,
    cutChangedRef,
  } = input.terrainView;
  const {
    grassStats,
    treeStats,
    understoryStats,
    forestLightingStats,
    grassSystem,
  } = input.runtime;
  const { colorByLodUserOverride } = input;
  const runtimePanel = document.getElementById("clod-overlay");
  const debugPanelsVisible = () => !infoPanel.hidden || runtimePanel?.hidden === false;
  const streamDiagnostics = createStreamDiagnosticTracker({
    cfg: input.cfg,
    maxTerrainLevel: input.maxTerrainLevel,
    phase0Config: input.longView.phase0Config,
    phase0TargetVisibleM: input.longView.phase0TargetVisibleM,
    queryScene: input.longView.queryScene,
  });
  let lastTreeGpuWarningLogged: string | null = null;

  const setPerfModeQuery = (enabled: boolean) => {
    const next = new URLSearchParams(location.search);
    if (enabled) next.set("clodPerf", "1");
    else next.delete("clodPerf");
    history.replaceState(null, "", `${location.pathname}${next.toString() ? `?${next.toString()}` : ""}${location.hash}`);
  };

  const logTreeGpuWarningIfNeeded = (warning: string | null) => {
    if (!warning || warning === lastTreeGpuWarningLogged) return;
    lastTreeGpuWarningLogged = warning;
    console.warn(`[trees] ${warning}`);
  };

  const currentOverlaySnapshot = (): ClodOverlaySnapshot => {
    const selection = selectionController.stats();
    return {
      worldSize: WORLD,
      renderedTriangles: selection.triCount,
      nodesByLod: selection.nodesByLod,
      forcedSplits: selection.forcedSplits,
      blockedSplits: 0,
      bubbleForcedSplits: selection.nearFieldForcedSplits,
      cutFrozen: state.freeze,
      errorThreshold: state.thresholdPx,
      treeGpuStatus: formatTreeGpuOverlayStatus(state.treesEnabled, state.treeGpuEnabled, treeStats.current),
      treeGpuWarning: formatTreeGpuFallbackWarning(state.treesEnabled, state.treeGpuEnabled, treeStats.current),
      buildStatus: buildStatusRef.value,
      digCostLine: session.lastDigSummary || undefined,
      polishLine,
    };
  };

  const updateInfo = () => {
    if (!debugPanelsVisible()) return;

    const selection = selectionController.stats();
    const streamLine = input.longView.isLongView
      ? `${streamDiagnostics.format(streamDiagnostics.update({ x: input.camera.position.x, z: input.camera.position.z }))}\n`
      : "";
    session.parentsHealthy = clodWorker.isParentsHealthy();
    const lastErr = clodWorker.getLastParentError();
    session.lastParentError = lastErr ? lastErr.message : "";
    const playerLine = interaction.mode === "playing"
      ? `player: grounded=${player.grounded}  physics p95=${player.physicsP95Ms().toFixed(2)} ms  collider pages=${player.lastPagesTested}`
      : `view: ${interaction.mode}`;
    const sceneLabel = queryGrassPerfScene ? "  GRASS PERF" : queryTreePerfScene ? "  TREE PERF" : queryForestFloorScene ? "  FOREST FLOOR" : "";
    logTreeGpuWarningIfNeeded(formatTreeGpuFallbackWarning(state.treesEnabled, state.treeGpuEnabled, treeStats.current));
    info.textContent =
      `Drusniel Voxels Web — ${WORLD}x${WORLD} pages${sceneLabel}\n` +
      `${formatWorldModeLine(input.camera.position.x, input.camera.position.z)}\n` +
      `cut: ${selection.renderedCount} nodes  (${selection.levelSummary})\n` +
      `tris rendered: ${selection.triCount.toLocaleString()}   2:1 forced splits: ${selection.forcedSplits}   ` +
      `bubble forced splits: ${selection.nearFieldForcedSplits}   xLOD borders: ${selection.crossLodAdjacencyCount}\n` +
      `threshold: ${state.thresholdPx.toFixed(2)} px   avg FPS: ${session.averageFpsRef.value.toFixed(1)}   ` +
      `${state.forceMaxLevel === "auto" ? "" : `forced<=${state.forceMaxLevel}   `}${state.freeze ? "[FROZEN]" : ""}\n` +
      `renderer: ${isWebGpu ? "WebGPU" : "WebGL"}   selection: ${selection.selectionSource} ${selection.selectionMs.toFixed(2)}ms   gpu-compute: ${selectionController.formatWebGpuStats(state.webgpuSelection)}\n` +
      streamLine +
      `${polishLine}\n` +
      `worker: parents pending=${session.pendingParentCount} rebuilt=${session.pendingParentNodes} ${session.pendingParentMs.toFixed(0)}ms` +
      `${session.parentsHealthy ? "" : `  PARENT FAIL: ${session.lastParentError}`}   ` +
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
      `tree impostors: ${state.treeImpostorSummary}\n` +
      `${formatUnderstoryInfoLine(state.understoryEnabled, state.understoryTotal, understoryStats.current)}\n` +
      `${formatForestLightingInfoLine(state.forestLightingEnabled, forestLightingStats.current)}\n` +
      (state.clodShadowStatsLine ? `clod shadows: ${state.clodShadowStatsLine}\n` : "") +
      `brush: ${state.digEnabled ? "on" : "off"}  ${state.brushOp === "add" ? "raise" : "dig"} ${state.brushShape} r=${state.digRadius}  edits=${digEditCount()}\n` +
      `${session.lastDigSummary ? `last: ${session.lastDigSummary}\n` : ""}` +
      `${session.lastArchiveSummary ? `${session.lastArchiveSummary}\n` : ""}` +
      playerLine;
    updateClodOverlay(currentOverlaySnapshot());
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
      if (!state.liveBubblePinned) state.bubble = false;
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

  cutChangedRef.fn = updateInfo;

  input.runtime.waterController.installDebugApi({
    exitToOrbit: () => input.interaction.exitToOrbit(),
    resetPlayerInput: () => input.bindings.resetPlayerInput(),
    setControlsEnabled: (enabled) => { input.controls.enabled = enabled; },
    setControlsTarget: (x, y, z) => { input.controls.target.set(x, y, z); },
    setCameraPosition: (x, y, z) => { input.camera.position.set(x, y, z); },
    cameraLookAt: (x, y, z) => { input.camera.lookAt(x, y, z); },
    controlsUpdate: () => { input.controls.update(); },
    updatePlayerModeUi: () => input.bindings.updatePlayerModeUi(),
    updateSelection: () => updateSelection(),
    setWaterDebugModeState: (mode) => { state.waterDebugMode = mode; },
  });

  return { updateInfo, currentOverlaySnapshot, applyClodPerfMode };
}
