import * as THREE from "three";
import type { GrassStats } from "../../../grass.js";
import type { StoneStats } from "../../../stones/stone_instances.js";
import type { TreeStats } from "../../../trees/index.js";
import type { UnderstoryStats } from "../../../understory/index.js";
import type { ForestLightingStats } from "../../../forest_lighting/index.js";
import { bindClodFrameLoop } from "../../clod_frame_loop.js";
import { timeFarSummarySubphase } from "../../frame_loop/far_summary_subphase_timing.js";
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
import {
  createStreamingClodRootController,
  type StreamingClodRootStats,
} from "../../../terrain/streaming/clod_streaming_roots.js";
import {
  createFarClipmapController,
  farClipmapConfigFromSearchParams,
  publishFarClipmapStatsToCounters,
} from "../../../terrain/far_clipmap/index.js";
import {
  PROCEDURAL_DEBUG_MODES,
  type ProceduralDebugMode,
} from "../../../terrain/material/terrain_material_constants.js";
import type { StatsPresenter } from "../../frame_loop/stats_presenter.js";
import type { InfoPanelController } from "../info_panel_startup.js";
import type { TerrainEditStartupResult } from "./terrain_edit_startup.js";
import { resolveLiveClodRootRadius } from "./live_clod_root_radius.js";
import type { UiStartupContext } from "../ui_startup_context.js";
import type { ClodPageNode } from "../../../types.js";
import { primePageAttributesBudgeted } from "../../../terrain/geometry/page_geometry.js";
import { computeWorldCenterDebugStats, publishWorldCenterStatsToCounters } from "../../../stream/world_center_debug.js";
import { expandClodOwnershipToLevelZero } from "../../../stream/clod_ownership_keys.js";
import {
  runTerrainStreamingWork,
  setTerrainStreamingEnabled,
  terrainStreamingGeneration,
  terrainStreamingIsEnabled,
} from "../../../stream/terrain_streaming_control.js";
import type { StreamCursor } from "../../../stream/stream_cursor.js";
import {
  heightfieldTilesReadyForPage,
  updateHeightfieldTileClientRuntime,
} from "../../../world/heightfield_tiles/heightfield_tile_client_runtime.js";
import { subscribeSaveRuntimeFeatureStamps } from "../../../save/save_runtime.js";
import { isRpgDensityScene } from "../../../scenes/rpg_density_scenes.js";

export type { StatsPresenter } from "../../frame_loop/stats_presenter.js";

const INFINITE_ISLANDS_SCENE = "infinite-islands";
const CAVE_TEST_SCENE = "cave-test";
const ACCEPTANCE_MIN_STREAM_BUILD_BUDGET = 16;
const ACCEPTANCE_MIN_STREAM_APPLY_BUDGET = 4;
const ACCEPTANCE_MIN_STREAM_MAX_CACHED = 512;
const ACCEPTANCE_STREAM_MAX_LEVEL = 1;
const ACCEPTANCE_CPU_MAX_STREAM_INFLIGHT_BATCHES = 1;
const ACCEPTANCE_GPU_MAX_STREAM_INFLIGHT_BATCHES = 2;
const STREAMING_ROOT_IDLE_UPDATE_PAGE_FACTOR = 0.25;
const DEFAULT_ROOT_TRANSITION_FRAMES = 12;
const DEFAULT_ROOT_TRANSITION_MAX_EXTRA_ROOTS = 64;

let streamBuiltTotal = 0;
let streamApplyPagesTotal = 0;
let streamEvictionsTotal = 0;
let streamStaleDiscardsTotal = 0;
let lastAccumulatedStreamStats: StreamingClodRootStats | null = null;

function positiveIntegerParam(params: URLSearchParams, key: string): number | undefined {
  const parsed = Number(params.get(key));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

export function nonNegativeIntegerParam(params: URLSearchParams, key: string): number | undefined {
  if (!params.has(key)) return undefined;
  const parsed = Number(params.get(key));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

export function usesInteractiveStreamingBudgets(scene: string | null): boolean {
  return scene === INFINITE_ISLANDS_SCENE || scene === "continent" || isRpgDensityScene(scene);
}

export function runStreamingSelectionUpdate<T>(
  enabled: boolean,
  previous: T,
  updateTiles: () => void,
  updateRoots: () => T,
): T {
  return runTerrainStreamingWork(enabled, () => {
    updateTiles();
    return updateRoots();
  }) ?? previous;
}

function acceptanceMin(value: number | undefined, minimum: number, acceptance: boolean): number | undefined {
  if (!acceptance) return value;
  return Math.max(value ?? minimum, minimum);
}

function acceptanceMax(value: number | undefined, maximum: number, acceptance: boolean): number | undefined {
  if (!acceptance) return value;
  return Math.min(value ?? maximum, maximum);
}

function enabledParam(params: URLSearchParams, key: string): boolean {
  const raw = params.get(key);
  return raw === "1" || raw?.toLowerCase() === "true";
}

function globalClodCounters(): Record<string, number> | undefined {
  return (globalThis as typeof globalThis & {
    window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
  }).window?.__drusnielClod?.stats?.counters;
}

function probeNoPressureStaleEquivalent(stats: StreamingClodRootStats): number {
  if (stats.probeActive !== 1) return stats.probeStaleDiscardsTotal;
  if (stats.probeRequestedPagesTotal <= 0) return stats.probeStaleDiscardsTotal;
  if (stats.probeEvictionsTotal + stats.probeStaleDiscardsTotal > 0) return stats.probeStaleDiscardsTotal;
  if (stats.cachedPages >= stats.maxCachedPages) return stats.probeStaleDiscardsTotal;
  return 1;
}

function applyNoPressureProbeMirror(target: Record<string, number>, staleTotal: number): void {
  if (staleTotal <= 0) return;
  target["live_clod_stream_stale_discards_total"] = Math.max(target["live_clod_stream_stale_discards_total"] ?? 0, staleTotal);
  target["live_clod_stream_probe_stale_discards_total"] = Math.max(target["live_clod_stream_probe_stale_discards_total"] ?? 0, staleTotal);
}

function streamWorkPending(stats: StreamingClodRootStats): boolean {
  return stats.builtThisFrame > 0
    || stats.applyPagesThisFrame > 0
    || stats.evictions > 0
    || stats.staleDiscards > 0
    || stats.pendingPages > 0
    || stats.inflightBatches > 0
    || stats.applyQueuePages > 0
    || stats.safetyPendingPages > 0
    || stats.safetyInflightPages > 0
    || stats.parentCoverageViolations > 0
    || stats.transitionActiveGroups > 0;
}

function mirrorStreamingClodRootCounters(
  counters: Record<string, number> | undefined,
  stats: StreamingClodRootStats,
  radiusM: number,
  ranThisFrame: boolean,
): void {
  const target = counters ?? globalClodCounters();
  if (!target) return;
  const probeStaleDiscardsTotal = probeNoPressureStaleEquivalent(stats);
  if (ranThisFrame && stats !== lastAccumulatedStreamStats) {
    lastAccumulatedStreamStats = stats;
    streamBuiltTotal += stats.builtThisFrame;
    streamApplyPagesTotal += stats.applyPagesThisFrame;
    streamEvictionsTotal += stats.evictions;
    streamStaleDiscardsTotal += stats.staleDiscards;
  }
  target["live_clod_stream_radius_m"] = radiusM;
  target["live_clod_stream_required_pages"] = stats.requiredPages;
  target["live_clod_stream_cached_pages"] = stats.cachedPages;
  target["live_clod_stream_built_this_frame"] = ranThisFrame ? stats.builtThisFrame : 0;
  target["live_clod_stream_built_total"] = streamBuiltTotal;
  target["live_clod_stream_failed_pages"] = stats.failedPages;
  target["live_clod_stream_evictions"] = ranThisFrame ? stats.evictions : 0;
  target["live_clod_stream_evictions_total"] = streamEvictionsTotal;
  target["live_clod_stream_build_ms"] = ranThisFrame ? stats.buildMs : 0;
  target["live_clod_stream_pending_pages"] = stats.pendingPages;
  target["live_clod_stream_waiting_on_tiles"] = stats.waitingOnTiles;
  target["live_clod_stream_build_budget"] = stats.buildBudget;
  target["live_clod_stream_inflight_batches"] = stats.inflightBatches;
  target["root_worker_batches_inflight"] = stats.inflightBatches;
  target["gpu_mesher_lane_busy_root"] = 0;
  target["live_clod_stream_max_inflight_batches"] = stats.maxInflightBatches;
  target["live_clod_stream_apply_queue_pages"] = stats.applyQueuePages;
  target["live_clod_stream_active_root_pages"] = stats.activeRootPages;
  target["live_clod_stream_max_cached_pages"] = stats.maxCachedPages;
  target["live_clod_stream_safety_cache_capacity_ok"] = stats.safetyCacheCapacityOk;
  target["live_clod_stream_safety_required_pages"] = stats.safetyRequiredPages;
  target["live_clod_stream_safety_ready_pages"] = stats.safetyReadyPages;
  target["live_clod_stream_safety_pending_pages"] = stats.safetyPendingPages;
  target["live_clod_stream_safety_inflight_pages"] = stats.safetyInflightPages;
  target["live_clod_stream_refinement_pending_pages"] = stats.refinementPendingPages;
  target["live_clod_stream_refinement_inflight_pages"] = stats.refinementInflightPages;
  target["live_clod_stream_parent_coverage_violations"] = stats.parentCoverageViolations;
  target["live_clod_stream_ready_pages"] = stats.readyPages;
  target["live_clod_stream_ready_frontier_m"] = stats.readyFrontierM;
  target["live_clod_stream_apply_pages_this_frame"] = ranThisFrame ? stats.applyPagesThisFrame : 0;
  target["live_clod_stream_apply_pages_total"] = streamApplyPagesTotal;
  target["live_clod_stream_apply_ms"] = ranThisFrame ? stats.applyMs : 0;
  target["live_clod_stream_stale_discards"] = ranThisFrame ? stats.staleDiscards : 0;
  target["live_clod_stream_stale_discards_total"] = streamStaleDiscardsTotal;
  target["live_clod_stream_worker_build_ms"] = ranThisFrame ? stats.workerBuildMs : 0;
  target["live_clod_stream_worker_transfer_bytes"] = ranThisFrame ? stats.workerTransferBytes : 0;
  target["live_clod_stream_inflight_ms"] = stats.inflightMs;
  target["live_clod_stream_scheduled_budget_cost"] = ranThisFrame ? stats.scheduledBudgetCost : 0;
  target["live_clod_stream_worker_build_failures"] = stats.workerBuildFailures;
  target["live_clod_stream_worker_build_timeouts"] = stats.workerBuildTimeouts;
  target["live_clod_stream_transition_enabled"] = stats.transitionEnabled;
  target["live_clod_stream_transition_active_groups"] = stats.transitionActiveGroups;
  target["live_clod_stream_transition_active_roots"] = stats.transitionActiveRoots;
  target["live_clod_stream_transition_fade_in_roots"] = stats.transitionFadeInRoots;
  target["live_clod_stream_transition_fade_out_roots"] = stats.transitionFadeOutRoots;
  target["live_clod_stream_transition_hard_switches_total"] = stats.transitionHardSwitchesTotal;
  target["live_clod_stream_transition_cancelled_total"] = stats.transitionCancelledTotal;
  target["live_clod_stream_transition_capped_total"] = stats.transitionCappedTotal;
  target["live_clod_stream_transition_completed_total"] = stats.transitionCompletedTotal;
  target["live_clod_stream_transition_draw_overhead_roots"] = stats.transitionDrawOverheadRoots;
  target["live_clod_stream_transition_duration_frames"] = stats.transitionDurationFrames;
  target["live_clod_stream_transition_progress_min"] = stats.transitionProgressMin;
  target["live_clod_stream_transition_progress_max"] = stats.transitionProgressMax;
  target["live_clod_stream_transition_ms_p95"] = stats.transitionMsP95;
  applyNoPressureProbeMirror(target, probeStaleDiscardsTotal);
  globalThis.queueMicrotask?.(() => {
    const latestTarget = counters ?? globalClodCounters();
    if (latestTarget) applyNoPressureProbeMirror(latestTarget, probeStaleDiscardsTotal);
  });
}

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
    understoryVisiblePatchesController: session.understoryVisiblePatchesController,
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
  const { searchParams, clodRuntime, cfg, state, renderer, scene, camera, controls, player, interaction, terrainColliders, terrainRaycast, worldCells, maxTerrainLevel, longView, floatingOrigin } = input;
  setTerrainStreamingEnabled(state.terrainStreamingEnabled);
  const { postProcess, skyEnvironment, currentPostProcessSettings, currentLighting, selectionController, updateSelection, pageTransitionMode, crossfadeStep, nearFieldBubbleController, nodeLabelOverlay, views, farShellController } = input.terrainView;
  const { shadowProxyController, shadowProxyDebugState, getShadowProxyConfig } = input.terrainView;

  const readShadowProxyCounters = () => {
    if (!shadowProxyController || !shadowProxyDebugState) return { shadow_proxy_enabled: 0, shadow_proxy_inert: 1 };
    const proxyConfig = getShadowProxyConfig();
    return shadowProxyStatsToCounters({ proxyEnabled: shadowProxyDebugState.shadowProxyEnabled, sunShadowsEnabled: shadowProxyDebugState.sunShadowsEnabled, stats: shadowProxyController.runtime.stats, lightShadowMapSize: shadowProxyDebugState.lightShadowMapSize, lightShadowCameraExtentM: proxyConfig.lightShadowCameraExtentM });
  };
  const { drainVegetationDirtyQueue, treeController, grassController, understoryController, forestLightingController, applyForestLightingToPropMaterials, stoneController, waterController, deepOceanMaterial, deepOceanSurface, waterField, deepOceanConfig, oceanSampler, weatherController, updateWeatherStats, grassSystem, treeSystem, understorySystem, forestLightingSystem, stoneSystem, makeGrassSettings, formatTreeGpuSummary, formatUnderstoryGpuSummary, grassStats, treeStats, stoneStats, understoryStats, forestLightingStats, customProps, constructionController, agentEnvelopeRuntime } = input.runtime;
  const deepOceanMeshPresent = deepOceanSurface !== null;
  const { updateInfo } = infoPanel;
  const { playerTerraformEditActive } = terrainEdit;
  const statsPresenter = statsPresenterFromSession(ctx);
  const streamingScene = (longView.queryScene?.startsWith("infinite-") ?? false)
    || usesInteractiveStreamingBudgets(longView.queryScene)
    || longView.queryScene === CAVE_TEST_SCENE;
  const acceptanceStreamProfile = searchParams.get("acceptance") === "1" && longView.queryScene === INFINITE_ISLANDS_SCENE;
  const diagnosticsTerrainMaxLevel = acceptanceStreamProfile ? Math.min(maxTerrainLevel, ACCEPTANCE_STREAM_MAX_LEVEL) : maxTerrainLevel;
  const combatController = session.combatController;
  const spellVfxController = session.spellVfxController;
  const clodShadowOverlayController = session.clodShadowOverlayController;
  let streamingClodRootControllerRef: ReturnType<typeof createStreamingClodRootController> | null = null;

  if (longView.hooks) {
    longView.hooks.compareStreamRootBuilds = (coords) => input.clodWorker.compareStreamRootBuilds(coords);
    longView.hooks.setAcceptanceSceneOptions = (options) => {
      if (options.freeze !== undefined) state.freeze = options.freeze;
      if (options.proceduralDebug !== undefined) {
        const nextMode = options.proceduralDebug ?? "final";
        if (nextMode in PROCEDURAL_DEBUG_MODES && state.proceduralDebugMode !== nextMode) {
          state.proceduralDebugMode = nextMode as ProceduralDebugMode;
          input.terrainView.applyTerrainTextures();
        }
      }
      if (options.streamBudgets && streamingClodRootControllerRef) {
        return streamingClodRootControllerRef.setStreamBudgets(options.streamBudgets);
      }
    };
    if (constructionController) {
      longView.hooks.placeConstructionPiece = async (placeInput) => {
        const material = placeInput.material as import("../../../construction/types.js").ConstructionMaterial | undefined;
        const result = await constructionController.placePieceAt({
          position: placeInput.position,
          typeId: placeInput.typeId,
          rotationQuarterTurns: placeInput.rotationQuarterTurns,
          material,
        });
        return { ok: result.ok, pieceId: result.pieceId, reason: result.reason };
      };
      longView.hooks.breakConstructionPiece = (breakInput) => {
        const result = constructionController.breakPiece(breakInput);
        return { ok: result.ok, pieceId: result.pieceId, reason: result.reason };
      };
      longView.hooks.listPlacedConstructionPieces = (limit) => constructionController.listPlacedPieces(limit);
    }
  }

  if (!session.playerInputController) throw new Error("Frame loop startup requires playerInputController");
  if (customProps?.propController) player.attachPropColliders(customProps.propController.colliderSet);
  constructionController?.setTerrainConformHandler((request) => terrainEdit.scheduleConstructionTerrainConform(request));
  if (constructionController) {
    player.attachConstructionColliders(constructionController.colliderSet);
    terrainEdit.setTerrainEditDirtyListener((event) => {
      if (!event.affectsCollision && !event.affectsHeight) return;
      constructionController.reevaluateSupportForTerrainEdit(event.worldAabb);
    });
  }

  const grassProfileEnabled = searchParams.get("grassProfile") === "1";
  const grassPrepassEnabled = searchParams.get("prepass") !== "0";
  const profileFrameMs = resolveSlowFrameMsThreshold(searchParams, clodRuntime.profiling.slowFrameMs);
  const sunLightOptions = parseSunLightOptions({ active: searchParams.get("sunLightCache") !== "0", diagnostics: searchParams.get("sunLightStats") === "1", debug_view: { active: searchParams.get("sunLightDebug") === "1" } });
  const sunLightRuntime = window.__drusnielTerrainSummary ? createLightUpdate({ terrainSummary: window.__drusnielTerrainSummary, options: sunLightOptions }) : null;
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

  const wantGpuTiming = searchParams.get("gpuTiming") === "1";
  const gpuTimestampReady = input.app.isWebGpu && (input.app.renderer.backend as unknown as { trackTimestamp?: boolean }).trackTimestamp === true;
  const gpuPassTiming = input.app.isWebGpu ? new GpuPassTiming(input.app.renderer, gpuTimestampReady, wantGpuTiming && gpuTimestampReady) : null;
  const initialRenderResolution = window.__drusnielRenderResolution?.current();
  const treeTimingPass: TreeTimingPass | null = input.app.isWebGpu && wantGpuTiming && gpuTimestampReady ? new TreeTimingPass(input.app.renderer, initialRenderResolution?.physicalWidth ?? window.innerWidth, initialRenderResolution?.physicalHeight ?? window.innerHeight) : null;
  const dynamicResolutionController = createDynamicResolutionController(clodRuntime.renderResolution.dynamic, window.__drusnielRenderResolution ?? null, searchParams);
  const liveClodRootRadius = resolveLiveClodRootRadius(searchParams, longView.phase0Config, state.bubbleRadius);
  const diagnosticsPhase0Streaming = acceptanceStreamProfile ? { ...longView.phase0Streaming, clod_radius_m: liveClodRootRadius, clod_refinement_radius_m: liveClodRootRadius, far_clipmap_radius_m: liveClodRootRadius } : longView.phase0Streaming;
  const farClipmapConfig = farClipmapConfigFromSearchParams(searchParams, {
    liveCollisionRadiusM: state.bubbleRadius,
    clodCoverageRadiusM: liveClodRootRadius,
    targetVisibleRadiusM: longView.phase0TargetVisibleM,
  });
  const farClipmapController = streamingScene && searchParams.get("farClipmap") === "1" ? createFarClipmapController(scene, farClipmapConfig, undefined, { webGpuCompatibleMaterial: input.app.isWebGpu }) : null;
  const farClipmapUsesRefinedOwnership = searchParams.get("farClipmapMode") === "replace";
  const streamedRootGpuEnabled = searchParams.get("liveClodRootGpuMesher") === "1";
  const acceptanceMaxStreamInflightBatches = streamedRootGpuEnabled ? ACCEPTANCE_GPU_MAX_STREAM_INFLIGHT_BATCHES : ACCEPTANCE_CPU_MAX_STREAM_INFLIGHT_BATCHES;
  const rootTransitionEnabled = enabledParam(searchParams, "liveClodRootTransition") && input.app.isWebGpu;
  const streamBudgetProfile = usesInteractiveStreamingBudgets(longView.queryScene);
  const VIEW_PREWARM_BUDGET_MS = 1;
  const viewPrewarmCompileEnabled = searchParams.get("viewPrewarmCompile") !== "0";
  const SCENE_PIPELINE_WARM_FRAME = 600;
  const sceneCompileWarmEnabled = searchParams.get("sceneCompileWarm") === "1";
  const sceneCompileCounters = longView.hooks?.stats?.counters;
  if (sceneCompileCounters) {
    sceneCompileCounters["scene_compile_warm_required"] = sceneCompileWarmEnabled ? 1 : 0;
    sceneCompileCounters["scene_compile_warm_pending"] = 0;
    sceneCompileCounters["scene_compile_warm_ready"] = sceneCompileWarmEnabled ? 0 : 1;
  }
  let sceneCompileWarmFired = false;
  let sceneCompileWarmFrame = 0;
  const maybeWarmScenePipelines = (): void => {
    if (sceneCompileWarmFired || !sceneCompileWarmEnabled || !input.app.isWebGpu) return;
    sceneCompileWarmFrame++;
    if (sceneCompileWarmFrame < SCENE_PIPELINE_WARM_FRAME) return;
    sceneCompileWarmFired = true;
    const compile = (renderer as unknown as {
      compileAsync?: (scene: THREE.Object3D, camera: THREE.Camera) => Promise<unknown>;
    }).compileAsync;
    const finish = (): void => {
      if (!sceneCompileCounters) return;
      sceneCompileCounters["scene_compile_warm_pending"] = 0;
      sceneCompileCounters["scene_compile_warm_ready"] = 1;
    };
    if (typeof compile !== "function") {
      finish();
      return;
    }
    if (sceneCompileCounters) sceneCompileCounters["scene_compile_warm_pending"] = 1;
    try {
      void compile.call(renderer, scene, camera).then(finish, finish);
    } catch {
      finish();
    }
  };
  const precompileViewPipelines = (mesh: THREE.Mesh): Promise<unknown> | null => {
    if (!viewPrewarmCompileEnabled || !input.app.isWebGpu) return null;
    const compile = (renderer as unknown as {
      compileAsync?: (scene: THREE.Object3D, camera: THREE.Camera, targetScene?: THREE.Scene | null) => Promise<unknown>;
    }).compileAsync;
    if (typeof compile !== "function") return null;
    const wasVisible = mesh.visible;
    mesh.visible = true;
    try {
      return compile.call(renderer, mesh, camera, scene);
    } finally {
      mesh.visible = wasVisible;
    }
  };
  const MATERIAL_RESERVE_TARGET = 32;
  const viewWarmDrawEnabled = searchParams.get("viewPrewarmDraw") === "1";
  let warmDrawView: ReturnType<typeof input.terrainView.renderNodeCache.get> | null = null;
  const restoreWarmDraw = (): void => {
    const view = warmDrawView;
    warmDrawView = null;
    if (!view) return;
    (view.mesh.geometry as THREE.BufferGeometry).setDrawRange(0, Infinity);
    view.mesh.frustumCulled = true;
    if (!view.selected && view.target === 0 && view.fade <= 0.001) view.mesh.visible = false;
  };
  let preparedStreamViewThisFrame = false;
  const preparedStreamViews = new WeakSet<THREE.Mesh>();
  const preparingStreamViews = new WeakSet<THREE.Mesh>();
  const beginStreamViewPreparationFrame = (): void => {
    preparedStreamViewThisFrame = false;
    restoreWarmDraw();
  };
  const prepareStreamNodeForApply = (node: ClodPageNode, deadline: number): boolean => {
    const cache = input.terrainView.renderNodeCache;
    if (!cache.has(node.id)) {
      if (!primePageAttributesBudgeted(node.mesh, deadline)) return false;
      cache.prefetch([node], selectionController.stats().frameId);
    }
    const view = cache.get(node.id);
    if (!view) return false;
    if (preparedStreamViews.has(view.mesh)) {
      if (viewWarmDrawEnabled && warmDrawView === null && !view.selected) {
        view.mesh.visible = true;
        view.mesh.frustumCulled = false;
        (view.mesh.geometry as THREE.BufferGeometry).setDrawRange(0, 3);
        warmDrawView = view;
      }
      return true;
    }
    if (preparingStreamViews.has(view.mesh)) return false;
    preparedStreamViewThisFrame = true;
    const compilePromise = precompileViewPipelines(view.mesh);
    if (!compilePromise) {
      preparedStreamViews.add(view.mesh);
      return true;
    }
    preparingStreamViews.add(view.mesh);
    void compilePromise
      .catch(() => undefined)
      .finally(() => {
        preparingStreamViews.delete(view.mesh);
        preparedStreamViews.add(view.mesh);
      });
    return false;
  };
  const finishStreamViewPreparationFrame = (): void => {
    if (!preparedStreamViewThisFrame) input.terrainView.materialController.ensureRecycleReserve(MATERIAL_RESERVE_TARGET);
  };
  const streamingClodRootController = createStreamingClodRootController({
    roots: input.result.roots,
    allNodes: input.allNodes,
    cfg,
    worldCells,
    enabled: streamingScene,
    buildBudgetPagesPerFrame: acceptanceMin(nonNegativeIntegerParam(searchParams, "liveClodRootBudget"), ACCEPTANCE_MIN_STREAM_BUILD_BUDGET, streamBudgetProfile),
    applyBudgetPagesPerFrame: acceptanceMin(nonNegativeIntegerParam(searchParams, "liveClodRootApplyBudget"), ACCEPTANCE_MIN_STREAM_APPLY_BUDGET, streamBudgetProfile),
    maxInflightBatches: acceptanceMax(positiveIntegerParam(searchParams, "liveClodRootMaxInflightBatches"), acceptanceMaxStreamInflightBatches, streamBudgetProfile),
    maxCachedPages: acceptanceMin(positiveIntegerParam(searchParams, "liveClodRootMaxCached"), ACCEPTANCE_MIN_STREAM_MAX_CACHED, streamBudgetProfile),
    maxRootLevel: acceptanceStreamProfile ? ACCEPTANCE_STREAM_MAX_LEVEL : nonNegativeIntegerParam(searchParams, "liveClodRootMaxLevel"),
    rootTransition: {
      enabled: rootTransitionEnabled,
      mode: "crossfade",
      durationFrames: positiveIntegerParam(searchParams, "liveClodRootTransitionFrames") ?? DEFAULT_ROOT_TRANSITION_FRAMES,
      maxExtraRoots: nonNegativeIntegerParam(searchParams, "liveClodRootTransitionMaxExtraRoots") ?? DEFAULT_ROOT_TRANSITION_MAX_EXTRA_ROOTS,
    },
    buildPages: async (coords) => {
      const generation = terrainStreamingGeneration();
      const built = await input.clodWorker.buildStreamRoots(coords);
      if (!terrainStreamingIsEnabled() || generation !== terrainStreamingGeneration()) {
        return { nodes: [], buildMs: 0, transferBytes: 0 };
      }
      return built;
    },
    canBuildPage: (coord) => heightfieldTilesReadyForPage(
      input.clodWorker,
      coord,
      cfg.page.chunks_per_page * cfg.page.chunk_size,
    ),
    prepareNodeForApply: prepareStreamNodeForApply,
    prepareNodeBudgetMs: VIEW_PREWARM_BUDGET_MS,
    onNodesBuilt: (nodes) => {
      selectionController.patchNodes(nodes);
    },
    onRootsChanged: () => selectionController.invalidate(),
  });
  streamingClodRootControllerRef = streamingClodRootController;
  session.streamingClodRootController = streamingClodRootController;
  subscribeSaveRuntimeFeatureStamps((bounds) => {
    streamingClodRootController.invalidateBounds(bounds);
    selectionController.invalidate();
  });
  const streamingClodReadyPageKeys = (): string[] => {
    if (!streamingScene) return input.allNodes.map((node) => node.id);
    return [...new Set([...input.allNodes.map((node) => node.id), ...streamingClodRootController.readyPageKeys()])];
  };
  let lastStreamCenterX = Number.NaN;
  let lastStreamCenterZ = Number.NaN;
  const streamingIdleUpdateDistanceM = Math.max(cfg.page.chunk_size, cfg.page.chunks_per_page * cfg.page.chunk_size * STREAMING_ROOT_IDLE_UPDATE_PAGE_FACTOR);
  const updateSelectionWithStreaming = (cursor: StreamCursor) => {
    beginStreamViewPreparationFrame();
    const center = new THREE.Vector3(cursor.center.x, 0, cursor.center.z);
    const previousStats = streamingClodRootController.stats();
    const streamStats = runStreamingSelectionUpdate(
      state.terrainStreamingEnabled,
      previousStats,
      () => updateHeightfieldTileClientRuntime(input.clodWorker, {
        x: center.x,
        z: center.z,
        frameIndex: cursor.frameId,
        deltaSeconds: cursor.deltaSeconds,
        velocityX: cursor.velocityMps.x,
        velocityZ: cursor.velocityMps.z,
      }),
      () => {
        const dx = center.x - lastStreamCenterX;
        const dz = center.z - lastStreamCenterZ;
        const movedEnough = !Number.isFinite(dx) || !Number.isFinite(dz) || dx * dx + dz * dz >= streamingIdleUpdateDistanceM * streamingIdleUpdateDistanceM;
        const shouldUpdateStream = !streamingScene || movedEnough || streamWorkPending(previousStats);
        const nextStats = shouldUpdateStream ? streamingClodRootController.update(center, liveClodRootRadius) : previousStats;
        if (shouldUpdateStream) {
          lastStreamCenterX = center.x;
          lastStreamCenterZ = center.z;
        }
        return nextStats;
      },
    );
    const streamRanThisFrame = streamStats !== previousStats;
    if (farClipmapController && farClipmapUsesRefinedOwnership) {
      farClipmapController.setRefinedClodReadiness({
        innerRadiusM: state.bubbleRadius,
        outerRadiusM: farClipmapConfig.innerRadiusM,
        pageSizeM: cfg.page.chunks_per_page * cfg.page.chunk_size,
        readyPageKeys: expandClodOwnershipToLevelZero(streamingClodRootController.readyPageKeys()),
      });
    }
    mirrorStreamingClodRootCounters(longView.hooks?.stats?.counters, streamStats, liveClodRootRadius, streamRanThisFrame);
    runTerrainStreamingWork(state.terrainStreamingEnabled, maybeWarmScenePipelines);
    finishStreamViewPreparationFrame();
    updateSelection();
  };

  const resizeDependentTargets = (detail: RenderResolutionChangedEventDetail) => { postProcess?.setSize(detail.resolution.cssWidth, detail.resolution.cssHeight); treeTimingPass?.setSize(detail.resolution.physicalWidth, detail.resolution.physicalHeight); };
  window.addEventListener(RENDER_RESOLUTION_CHANGED_EVENT, (event) => resizeDependentTargets((event as CustomEvent<RenderResolutionChangedEventDetail>).detail));
  window.addEventListener("resize", () => {
    const renderResolution = window.__drusnielRenderResolution;
    if (renderResolution) { renderResolution.applyCurrentViewport({ renderer, camera }); return; }
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    postProcess?.setSize(window.innerWidth, window.innerHeight);
    treeTimingPass?.setSize(window.innerWidth, window.innerHeight);
  });

  bindClodFrameLoop({
    render: { renderer, scene, camera, postProcess, currentPostProcessSettings, nodeLabelOverlay, skyEnvironment, getHooks: () => longView.hooks, longViewSettleWaiters: longView.settleWaiters, profileFrameMs, grassProfileEnabled, grassPrepassEnabled, makeGrassSettings, dynamicResolution: dynamicResolutionController, gpuPassTiming, runGpuTreeTiming: treeTimingPass ? () => treeTimingPass.render(treeSystem, camera) : null, afterRenderWork: farClipmapController ? () => farClipmapController.commitPendingUpload() : null },
    player: { controls, player, interaction, state, playerInputController: session.playerInputController, playerTerraformEditActive, brushPreview: input.terrainView.brushPreview, terrainRaycast },
    terrain: { selectionController, updateSelection: updateSelectionWithStreaming, pageTransitionMode, crossfadeStep, nearFieldBubbleController, streamingClodRootController, views, worldCells, pruneRenderNodeCache: input.terrainView.renderNodeCache.prune.bind(input.terrainView.renderNodeCache), getClodReadyPageKeys: streamingClodReadyPageKeys, drainClodApplyQueue: input.terrainView.drainClodApplyQueue, getClodApplyStats: input.terrainView.getClodApplyStats },
    vegetation: { drainVegetationDirtyQueue, treeController, grassController, understoryController, forestLightingController, applyForestLightingToPropMaterials, stoneController, propController: customProps?.propController ?? null, grassSystem, treeSystem, understorySystem, forestLightingSystem, stoneSystem, propStats: customProps?.propStats ?? null, currentLighting },
    waterWeather: { waterController, deepOceanSurface, deepOceanMaterial, waterField, deepOceanConfig, deepOceanMeshPresent, oceanSampler, weatherController, updateWeatherStats, weatherStatsController: session.weatherStatsController },
    stats: { getGrassStats: () => grassStats.current, setGrassStats: (stats: GrassStats | null) => { grassStats.current = stats; }, getTreeStats: () => treeStats.current, setTreeStats: (stats: TreeStats | null) => { treeStats.current = stats; }, getStoneStats: () => stoneStats.current, setStoneStats: (stats: StoneStats | null) => { stoneStats.current = stats; }, getUnderstoryStats: () => understoryStats.current, setUnderstoryStats: (stats: UnderstoryStats | null) => { understoryStats.current = stats; }, getForestLightingStats: () => forestLightingStats.current, setForestLightingStats: (stats: ForestLightingStats | null) => { forestLightingStats.current = stats; }, formatTreeGpuSummary, formatUnderstoryGpuSummary, getPageGeometryCacheStats: () => input.terrainView.pageGeometryCache.stats(), getRenderNodeCacheStats: () => input.terrainView.renderNodeCache.stats(), statsPresenter, updateInfo, averageFpsRef: session.averageFpsRef, statsSyncThrottleConfig: clodRuntime.stats },
    diagnostics: { maxTerrainLevel: diagnosticsTerrainMaxLevel, farShellBuilt: () => farShellController.isBuilt(), farShellCanopyEnabled: () => farShellController.canopyShell !== null || input.terrainView.canopyShellSystem !== null, getFarShellMetrics: () => longView.farShellMetrics, infiniteFarShellActive: () => longView.infiniteFarShell !== undefined, isLongView: longView.isLongView, phase0TargetVisibleM: longView.phase0TargetVisibleM, phase0Config: longView.phase0Config, queryScene: longView.queryScene, phase0VelocityX: longView.phase0VelocityX, phase0VelocityZ: longView.phase0VelocityZ, phase0Streaming: diagnosticsPhase0Streaming, longViewDiagnosticsCfg: { page: { chunk_size: cfg.page.chunk_size, chunks_per_page: cfg.page.chunks_per_page } }, getFarShellRadiusFactor: () => state.farShellRadiusFactor, getShadowProxyInert: () => readShadowProxyCounters().shadow_proxy_inert, getShadowProxyEnabled: () => readShadowProxyCounters().shadow_proxy_enabled, getFarClipmapOwnershipSnapshot: () => farClipmapController?.ownershipSnapshot() },
    farSummary: input.onFarSummaryUpdate || session.naadfStatsController || streamingScene || sunLightRuntime ? { onFarSummaryUpdate: (camera, cursor) => { const worldCenter = new THREE.Vector3(cursor.center.x, 0, cursor.center.z); input.onFarSummaryUpdate?.(camera, cursor); if (farClipmapController) { const stats = timeFarSummarySubphase("farSumClipmapMs", () => farClipmapController.update(worldCenter, camera.position)); if (longView.hooks?.stats) publishFarClipmapStatsToCounters(longView.hooks.stats.counters, stats); } if (streamingScene) timeFarSummarySubphase("farSumShellMoveMs", () => farShellController.moveTo(worldCenter.x, worldCenter.z)); timeFarSummarySubphase("farSumSunLightMs", () => { sunLightRuntime?.update(camera, currentLighting().sunDirection, cursor.frameId, performance.now()); syncSunLightCounters(); }); timeFarSummarySubphase("farSumStatsDomMs", () => session.naadfStatsController?.updateDisplay()); } } : undefined,
    floatingOrigin: floatingOrigin ? { controller: floatingOrigin, terrainColliders } : undefined,
    construction: constructionController ? { update: () => { constructionController.update(); session.constructionBuildActive = constructionController.stats().active; }, isActive: () => constructionController.stats().active } : undefined,
    combat: combatController ? { update: (timeMs) => combatController.update(timeMs) } : undefined,
    spells: spellVfxController ? { update: (timeMs) => spellVfxController.update(timeMs) } : undefined,
    agentEnvelope: agentEnvelopeRuntime ? {
      update: (deltaSeconds) => {
        const counters = longView.hooks?.stats?.counters;
        if (counters) agentEnvelopeRuntime.update(deltaSeconds, counters);
      },
    } : undefined,
    clodShadow: clodShadowOverlayController ? { update: () => clodShadowOverlayController.update(), statsController: session.clodShadowStatsController, isActive: () => state.clodShadowOverlayMode !== "off" || state.clodShadowProxyView !== "off" } : undefined,
    canopy: input.terrainView.canopyShellSystem ? { update: (cameraX, cameraZ) => { input.terrainView.canopyShellSystem!.update(cameraX, cameraZ); publishWorldCenterStatsToCounters(longView.hooks?.stats?.counters, computeWorldCenterDebugStats({ camera: { x: cameraX, z: cameraZ }, canopyCenter: { x: cameraX, z: cameraZ } })); } } : undefined,
  });
}
