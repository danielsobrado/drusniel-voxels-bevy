import * as THREE from "three";
import type { ClodHooks } from "../../core/hooks.js";
import type { GrassStats } from "../../grass.js";
import type { TreeStats } from "../../trees/index.js";
import type { UnderstoryStats } from "../../understory/index.js";
import type { PropStats } from "../../props/prop_stats.js";
import type { PostProcessSettings } from "../../environment/postprocess.js";
import type { NodeLabelOverlay } from "../../ui/node_labels.js";
import type { AppPostProcess } from "../app_post_process.js";
import type { AppSky } from "../../scene/app_sky.js";
import type { NearFieldBubbleController } from "../../terrain/near_field/near_field_bubble_controller.js";
import type { ClodSelectionController } from "../../terrain/selection/clod_selection_controller.js";
import type { PlayerInteractionState } from "../../player_controller.js";
import type { FrameRenderer } from "./frame_renderer.js";
import type { VegetationFrameTiming } from "./vegetation_frame_phase.js";
import type { FramePerfPhaseTiming, FramePerfProbe } from "./perf_probe.js";
import { takeFarSummarySubphaseTimings } from "./far_summary_subphase_timing.js";
import type { StatsSyncThrottleDecision, StatsSyncThrottleDiagnostics } from "./stats_sync_throttle.js";
import type { DynamicResolutionController, DynamicResolutionStats } from "../../rendering/dynamic_resolution.js";
import { materialChurnDiagnostics } from "../../rendering/material_churn/material_churn_diagnostics.js";

export interface RenderPhaseInput {
  renderer: FrameRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Skydome/environment. Re-centred on the camera each frame so it reads as infinitely far. */
  skyEnvironment: AppSky | null;
  postProcess: AppPostProcess | null;
  currentPostProcessSettings: () => PostProcessSettings;
  nodeLabelOverlay: NodeLabelOverlay;
  selectionController: ClodSelectionController;
  getHooks: () => ClodHooks | null;
  longViewSettleWaiters: { frames: number; resolve: () => void }[];
  frameStart: number;
  profileEnabled: boolean;
  profileFrameMs: number;
  grassProfileEnabled: boolean;
  grassProfileFrame: { value: number };
  currentGrassStats: GrassStats | null;
  currentTreeStats: TreeStats | null;
  currentUnderstoryStats: UnderstoryStats | null;
  currentPropStats: PropStats | null;
  tPropsStart: number;
  tBubbleStart: number;
  vegetationTiming: VegetationFrameTiming;
  chunkGroupsBuiltThisFrame: number;
  nearFieldBubbleController: NearFieldBubbleController;
  interaction: PlayerInteractionState;
  makeGrassSettings: () => import("../../grass.js").GrassSettings;
  grassPrepassEnabled: boolean;
  perfProbe: FramePerfProbe | null;
  phaseTiming: FramePerfPhaseTiming;
  statsSyncThrottle: {
    decision: StatsSyncThrottleDecision;
    diagnostics: StatsSyncThrottleDiagnostics;
  };
  gpuPasses: Record<string, number> | null;
  dynamicResolution?: DynamicResolutionController | null;
  afterRenderDiagnostics?: () => void;
}

const grassProfileMs = (value: number | null): string => value === null ? "-" : `${value.toFixed(2)}ms`;

type UnderstoryStatsWithConsulted = UnderstoryStats & { gpuPrefilterFarSummaryConsulted?: number };

type ExtraPhaseTiming = FramePerfPhaseTiming & Record<string, number>;

const DYNAMIC_RESOLUTION_REASON_CODE: Record<DynamicResolutionStats["reason"], number> = {
  disabled: 0,
  mode_disabled: 1,
  warming: 2,
  settling: 3,
  stable: 4,
  scale_down: 5,
  scale_up: 6,
};

const SELECTION_CACHE_REASON_CODE: Record<string, number> = {
  hit: 0,
  first_frame: 1,
  disabled: 2,
  camera_bucket_changed: 3,
  settings_changed: 4,
  near_field_changed: 5,
  stale_revision_changed: 6,
  webgpu_error_source_changed: 7,
  debug_state_changed: 8,
  max_reuse_frames_exceeded: 9,
  forced_invalidate: 10,
};

function selectionCacheReasonCode(reason: string): number {
  return SELECTION_CACHE_REASON_CODE[reason] ?? -1;
}

function phaseExtra(input: FramePerfPhaseTiming, key: string): number {
  const value = (input as ExtraPhaseTiming)[key];
  return Number.isFinite(value) ? value : 0;
}

function logGrassProfile(
  stats: GrassStats,
  grassAndPropsMs: number,
  grassProfileEnabled: boolean,
  makeGrassSettings: () => import("../../grass.js").GrassSettings,
  grassPrepassEnabled: boolean,
): void {
  if (!grassProfileEnabled) return;
  const settings = makeGrassSettings();
  const visible = grassVisibleCount(stats);
  console.info(
    `[grass-profile] mode=${stats.mode}` +
      ` dispatch=${grassProfileMs(stats.gpuRingDispatchMs)}` +
      ` readback=${grassProfileMs(stats.gpuRingReadbackMs)}` +
      ` visible=${visible}` +
      ` near=${stats.gpuRingVisibleNear}` +
      ` mid=${stats.gpuRingVisibleMid}` +
      ` far=${stats.gpuRingVisibleFar}` +
      ` super=${stats.gpuRingVisibleSuper}` +
      ` prepass=${grassPrepassEnabled ? "on" : "off"}` +
      ` grid=${settings.ring.grid}` +
      ` cell=${settings.ring.cell}` +
      ` slots=${settings.ring.grid * settings.ring.grid}` +
      ` grass+props=${grassAndPropsMs.toFixed(2)}ms`,
  );
}

function grassVisibleCount(stats: GrassStats): number {
  return stats.gpuRingVisibleNear + stats.gpuRingVisibleMid + stats.gpuRingVisibleFar + stats.gpuRingVisibleSuper;
}

function formatVegetationTiming(timing: VegetationFrameTiming, propsMs: number): string {
  const restMs = Math.max(0, propsMs - timing.totalMs);
  return `vegTotal ${timing.totalMs.toFixed(1)}` +
    ` rest ${restMs.toFixed(1)}` +
    ` grass ${timing.grassMs.toFixed(1)}` +
    ` trees ${timing.treesMs.toFixed(1)}` +
    ` under ${timing.understoryMs.toFixed(1)}` +
    ` forest ${timing.forestLightingMs.toFixed(1)}` +
    ` stones ${timing.stonesMs.toFixed(1)}` +
    ` custom ${timing.customPropsMs.toFixed(1)}` +
    ` water ${timing.waterMs.toFixed(1)}` +
    ` ocean ${timing.deepOceanMs.toFixed(1)}` +
    ` weather ${timing.weatherMs.toFixed(1)}`;
}

function recordDynamicResolutionCounters(counters: Record<string, number>, stats: DynamicResolutionStats): void {
  counters["dynamicResolution.enabled"] = stats.enabled ? 1 : 0;
  counters["dynamicResolution.active"] = stats.active ? 1 : 0;
  counters["dynamicResolution.frameMsAvg"] = stats.frameMsAvg;
  counters["dynamicResolution.targetMs"] = stats.targetMs;
  counters["dynamicResolution.renderScale"] = stats.renderScale;
  counters["dynamicResolution.minScale"] = stats.minScale;
  counters["dynamicResolution.maxScale"] = stats.maxScale;
  counters["dynamicResolution.adjustments"] = stats.adjustments;
  counters["dynamicResolution.reason"] = DYNAMIC_RESOLUTION_REASON_CODE[stats.reason];
}

function globalDynamicResolution(): DynamicResolutionController | undefined {
  return typeof window !== "undefined" ? window.__drusnielDynamicResolution : undefined;
}

export function runRenderPhase(input: RenderPhaseInput): void {
  // Keep the skydome centred on the camera so it never drifts / gets "left behind" as the player
  // streams far from the world origin (the sky mesh is built once at the origin).
  input.skyEnvironment?.updateCamera(input.camera);
  const selectionStats = input.selectionController.stats();
  input.nodeLabelOverlay.update({
    nodes: selectionStats.renderedNodes,
    camera: input.camera,
    viewport: input.renderer.domElement,
    viewportHeight: input.renderer.domElement.height,
    fovY: THREE.MathUtils.degToRad(input.camera.fov),
  });
  input.postProcess?.updateSettings(input.currentPostProcessSettings());

  const tRenderStart = performance.now();
  if (input.grassProfileEnabled && input.currentGrassStats && input.grassProfileFrame.value++ % 60 === 0) {
    logGrassProfile(
      input.currentGrassStats,
      tRenderStart - input.tPropsStart,
      input.grassProfileEnabled,
      input.makeGrassSettings,
      input.grassPrepassEnabled,
    );
  }

  if (input.postProcess) input.postProcess.render(input.scene, input.camera);
  else input.renderer.render(input.scene, input.camera);
  materialChurnDiagnostics.sampleRendererInfo(input.renderer);
  const tRenderEnd = performance.now();
  const frameMs = tRenderEnd - input.frameStart;

  input.afterRenderDiagnostics?.();

  const hooks = input.getHooks();
  const dynamicResolution = input.dynamicResolution ?? globalDynamicResolution();
  const dynamicResolutionStats = dynamicResolution?.update({
    frameMs,
    frameIndex: selectionStats.frameId,
    renderer: input.renderer,
    camera: input.camera,
  });
  if (hooks?.stats && dynamicResolutionStats) {
    recordDynamicResolutionCounters(hooks.stats.counters, dynamicResolutionStats);
  }

  if (hooks && !hooks.ready) {
    const startupTimings = hooks.startupTimings ?? window.__drusnielStartupTimings ?? null;
    if (startupTimings) {
      const startedAt = startupTimings["startup.started_at_ms"];
      if (Number.isFinite(startedAt)) {
        startupTimings["startup.first_render_ready_ms"] = performance.now() - startedAt;
        startupTimings["startup_first_render_ready_ms"] = startupTimings["startup.first_render_ready_ms"];
      }
      hooks.startupTimings = startupTimings;
      if (hooks.stats) {
        for (const [key, value] of Object.entries(startupTimings)) {
          if (Number.isFinite(value)) hooks.stats.counters[key] = value;
        }
      }
    }
    hooks.ready = true;
    hooks.progress = 1;
    hooks.progressMsg = "ready";
  }

  for (const waiter of input.longViewSettleWaiters) waiter.frames -= 1;
  const doneWaiters = input.longViewSettleWaiters.filter((w) => w.frames <= 0);
  for (const waiter of doneWaiters) waiter.resolve();
  for (const waiter of doneWaiters) {
    const index = input.longViewSettleWaiters.indexOf(waiter);
    if (index >= 0) input.longViewSettleWaiters.splice(index, 1);
  }

  if (input.profileEnabled || input.perfProbe) {
    const bubbleMs = input.tPropsStart - input.tBubbleStart;
    const propsMs = tRenderStart - input.tPropsStart;
    const renderMs = tRenderEnd - tRenderStart;
    const materialChurnStats = materialChurnDiagnostics.frameStats();
    const otherMs = frameMs - selectionStats.selectionMs - bubbleMs - propsMs - renderMs;
    const vegetationPhaseMs = input.phaseTiming.vegetationTotalMs || input.vegetationTiming.totalMs;
    const propsUnattributedMs = Math.max(
      0,
      propsMs -
        input.phaseTiming.farSummaryMs -
        input.phaseTiming.shadowProxyMs -
        input.phaseTiming.clodShadowMs -
        input.phaseTiming.canopyMs -
        vegetationPhaseMs -
        input.phaseTiming.borderOceanDebugMs -
        input.phaseTiming.statsSyncMs,
    );
    const measuredTopLevelMs =
      input.phaseTiming.frameSetupMs +
      input.phaseTiming.inputMs +
      input.phaseTiming.selectionUpdateMs +
      input.phaseTiming.clodApplyMs +
      input.phaseTiming.longViewDiagnosticsMs +
      input.phaseTiming.farSummaryMs +
      input.phaseTiming.constructionMs +
      input.phaseTiming.brushMs +
      input.phaseTiming.combatMs +
      input.phaseTiming.spellsMs +
      input.phaseTiming.terrainPhaseMs +
      input.phaseTiming.shadowProxyMs +
      input.phaseTiming.clodShadowMs +
      input.phaseTiming.canopyMs +
      vegetationPhaseMs +
      input.phaseTiming.borderOceanDebugMs +
      input.phaseTiming.statsSyncMs +
      renderMs;
    const grassStats = input.currentGrassStats;
    const treeStats = input.currentTreeStats;
    const understoryStats = input.currentUnderstoryStats;
    const understoryStatsWithConsulted = understoryStats as UnderstoryStatsWithConsulted | null;
    const propStats = input.currentPropStats;
    const farSummarySubphases = takeFarSummarySubphaseTimings();
    const selectionCacheStats = selectionStats.selectionCache;
    const selectionCacheReason = selectionCacheStats.lastReason;
    const selectionCacheReasonNumeric = selectionCacheReasonCode(selectionCacheReason);
    input.perfProbe?.record({
      frameId: selectionStats.frameId,
      frameMs,
      selectionMs: selectionStats.selectionMs,
      frameSetupMs: input.phaseTiming.frameSetupMs,
      inputMs: input.phaseTiming.inputMs,
      selectionUpdateMs: input.phaseTiming.selectionUpdateMs,
      "selectionOuter.updateCallMs": phaseExtra(input.phaseTiming, "selectionOuter.updateCallMs"),
      "selectionOuter.statsCallMs": phaseExtra(input.phaseTiming, "selectionOuter.statsCallMs"),
      "selectionOuter.wrapperGapMs": phaseExtra(input.phaseTiming, "selectionOuter.wrapperGapMs"),
      clodApplyMs: input.phaseTiming.clodApplyMs,
      longViewDiagnosticsMs: input.phaseTiming.longViewDiagnosticsMs,
      farSummaryMs: input.phaseTiming.farSummaryMs,
      ...farSummarySubphases,
      constructionMs: input.phaseTiming.constructionMs,
      brushMs: input.phaseTiming.brushMs,
      combatMs: input.phaseTiming.combatMs,
      spellsMs: input.phaseTiming.spellsMs,
      terrainPhaseMs: input.phaseTiming.terrainPhaseMs,
      shadowProxyMs: input.phaseTiming.shadowProxyMs,
      clodShadowMs: input.phaseTiming.clodShadowMs,
      canopyMs: input.phaseTiming.canopyMs,
      borderOceanDebugMs: input.phaseTiming.borderOceanDebugMs,
      statsSyncMs: input.phaseTiming.statsSyncMs,
      statsSyncRan: input.statsSyncThrottle.decision.shouldRun ? 1 : 0,
      statsSyncRuns: input.statsSyncThrottle.diagnostics.runs,
      statsSyncSkips: input.statsSyncThrottle.diagnostics.skips,
      statsSyncThrottleReason: input.statsSyncThrottle.decision.reason,
      statsSyncHzEffective: input.statsSyncThrottle.diagnostics.effectiveHz,
      unattributedMs: Math.max(0, frameMs - measuredTopLevelMs),
      selectionCutMs: selectionStats.subphases.cut,
      selectionBookMs: selectionStats.subphases.book,
      selectionInfoMs: selectionStats.subphases.info,
      selectionOverlaysMs: selectionStats.subphases.overlays,
      "selectionSub.settings": selectionStats.subphases.settings,
      "selectionSub.params": selectionStats.subphases.params,
      "selectionSub.compute": selectionStats.subphases.compute,
      "selectionSub.readback": selectionStats.subphases.readback,
      "selectionSub.parity": selectionStats.subphases.parity,
      "selectionSub.lookup": selectionStats.subphases.lookup,
      "selectionSub.cache": selectionStats.subphases.cache,
      "selectionSub.cut": selectionStats.subphases.cut,
      "selectionSub.book": selectionStats.subphases.book,
      "selectionSub.markActive": selectionStats.subphases.markActive,
      "selectionSub.apply": selectionStats.subphases.apply,
      "selectionSub.stats": selectionStats.subphases.stats,
      "selectionSub.hash": selectionStats.subphases.hash,
      "selectionSub.commit": selectionStats.subphases.commit,
      "selectionSub.info": selectionStats.subphases.info,
      "selectionSub.overlays": selectionStats.subphases.overlays,
      "selectionSub.dispatch": selectionStats.subphases.dispatch,
      "selectionSub.total": selectionStats.subphases.total,
      selectionCutCacheEnabled: selectionCacheStats.enabled ? 1 : 0,
      selectionCutCacheHits: selectionCacheStats.hits,
      selectionCutCacheMisses: selectionCacheStats.misses,
      selectionCutCacheInvalidations: selectionCacheStats.invalidations,
      selectionCutCacheLastReason: selectionCacheReason,
      selectionCutCacheLastReasonCode: selectionCacheReasonNumeric,
      cachedFastHits: selectionStats.cachedFastHits,
      bubbleMs,
      propsMs,
      vegetationTotalMs: vegetationPhaseMs,
      propsRestMs: Math.max(0, propsMs - vegetationPhaseMs),
      grassMs: input.vegetationTiming.grassMs,
      treesMs: input.vegetationTiming.treesMs,
      understoryMs: input.vegetationTiming.understoryMs,
      forestLightingMs: input.vegetationTiming.forestLightingMs,
      stonesMs: input.vegetationTiming.stonesMs,
      customPropsMs: input.vegetationTiming.customPropsMs,
      waterMs: input.vegetationTiming.waterMs,
      deepOceanMs: input.vegetationTiming.deepOceanMs,
      weatherMs: input.vegetationTiming.weatherMs,
      propsUnattributedMs,
      renderMs,
      otherMs,
      renderedCount: selectionStats.renderedCount,
      terrainTriangles: selectionStats.triCount,
      chunkGroupsBuilt: input.chunkGroupsBuiltThisFrame,
      nearFieldChunkGroups: input.nearFieldBubbleController.size(),
      interactionMode: input.interaction.mode,
      treeGpuStatus: treeStats?.gpuStatus ?? "unknown",
      treeTotalTrees: treeStats?.totalTrees ?? 0,
      treeVisiblePatches: treeStats?.visiblePatches ?? 0,
      treePatches: treeStats?.patches ?? 0,
      treeNearTrees: treeStats?.nearTrees ?? 0,
      treeMidTrees: treeStats?.midTrees ?? 0,
      treeFarTrees: treeStats?.farTrees ?? 0,
      treeImpostorTrees: treeStats?.impostorTrees ?? 0,
      treeHeroNearTriangles: treeStats?.heroNearTreeTriangles ?? 0,
      treeHeroNearFoliageTriangles: treeStats?.heroNearFoliageTriangles ?? 0,
      treeHeroNearMinTreeTriangles: treeStats?.heroNearMinTreeTriangles ?? 0,
      treeHeroNearAvgTreeTriangles: treeStats?.heroNearAvgTreeTriangles ?? 0,
      treeHeroNearPassesTriangleFloor: treeStats?.heroNearPassesTriangleFloor ? 1 : 0,
      treeHeroNearPassesRealFoliage: treeStats?.heroNearPassesRealFoliage ? 1 : 0,
      treeGpuCandidateCount: treeStats?.gpuCandidateCount ?? 0,
      treeGpuCandidateCountBeforePrefilter: treeStats?.gpuCandidateCountBeforePrefilter ?? 0,
      treeGpuCandidateCountAfterPrefilter: treeStats?.gpuCandidateCountAfterPrefilter ?? 0,
      treeGpuPrefilterRejectedClusters: treeStats?.gpuPrefilterRejectedClusters ?? 0,
      treeGpuPrefilterSkippedCandidateEstimate: treeStats?.gpuPrefilterSkippedCandidateEstimate ?? 0,
      treeGpuPrefilterFarSummaryConsulted: treeStats?.gpuPrefilterFarSummaryConsulted ?? 0,
      treeGpuPrefilterSourceFarSummary: treeStats?.gpuPrefilterSourceFarSummary ?? 0,
      treeGpuPrefilterSourceTerrainSampler: treeStats?.gpuPrefilterSourceTerrainSampler ?? 0,
      treeGpuPrefilterSourceFallback: treeStats?.gpuPrefilterSourceFallback ?? 0,
      treeGpuAcceptedCount: treeStats?.gpuAcceptedCount ?? 0,
      treeGpuVisibleCount: treeStats?.gpuVisibleCount ?? 0,
      treeGpuShadowCasterCount: treeStats?.gpuShadowCasterCount ?? 0,
      treeGpuShadowOverflowed: treeStats?.gpuShadowOverflowed ? 1 : 0,
      treeGpuDispatchMs: treeStats?.gpuDispatchMs ?? null,
      treeVisibleClusterHidden: treeStats?.visibleClusterHidden ?? 0,
      treeVisibleClusterVisible: treeStats?.visibleClusterVisible ?? 0,
      treeVisibleClusterUnknownKept: treeStats?.visibleClusterUnknownKept ?? 0,
      grassGpuCandidateCount: grassStats?.gpuRingCandidateCount ?? 0,
      grassGpuCandidateCountBeforePrefilter: grassStats?.gpuRingCandidateCountBeforePrefilter ?? 0,
      grassGpuCandidateCountAfterPrefilter: grassStats?.gpuRingCandidateCountAfterPrefilter ?? 0,
      grassGpuPrefilterFarSummaryConsulted: grassStats?.gpuRingPrefilterFarSummaryConsulted ?? 0,
      grassGpuPrefilterSourceFarSummary: grassStats?.gpuRingPrefilterSourceFarSummary ?? 0,
      grassGpuPrefilterSourceTerrainSampler: grassStats?.gpuRingPrefilterSourceTerrainSampler ?? 0,
      grassGpuPrefilterSourceFallback: grassStats?.gpuRingPrefilterSourceFallback ?? 0,
      grassGpuAcceptedCount: grassStats?.acceptedCandidates ?? 0,
      grassGpuVisibleCount: grassStats ? grassVisibleCount(grassStats) : 0,
      understoryGpuCandidateCount: understoryStats?.gpuCandidateCount ?? 0,
      understoryGpuCandidateCountBeforePrefilter: understoryStats?.gpuCandidateCountBeforePrefilter ?? 0,
      understoryGpuCandidateCountAfterPrefilter: understoryStats?.gpuCandidateCountAfterPrefilter ?? 0,
      understoryGpuPrefilterFarSummaryConsulted: understoryStatsWithConsulted?.gpuPrefilterFarSummaryConsulted ?? 0,
      understoryGpuPrefilterSourceFarSummary: understoryStats?.gpuPrefilterSourceFarSummary ?? 0,
      understoryGpuPrefilterSourceTerrainSampler: understoryStats?.gpuPrefilterSourceTerrainSampler ?? 0,
      understoryGpuPrefilterSourceFallback: understoryStats?.gpuPrefilterSourceFallback ?? 0,
      understoryGpuAcceptedCount: understoryStats?.gpuAcceptedCount ?? 0,
      understoryGpuVisibleCount: understoryStats?.gpuVisibleCount ?? 0,
      customPropGpuStatus: propStats?.gpuStatus ?? "unknown",
      customPropTotalInstances: propStats?.totalInstances ?? 0,
      customPropVisibleInstances: propStats?.instancesVisible ?? 0,
      customPropGpuCandidateCount: propStats?.gpuCandidateCount ?? 0,
      customPropGpuVisibleCount: propStats?.gpuVisibleCount ?? 0,
      customPropGpuOverflowed: propStats?.gpuOverflowed ? 1 : 0,
      customPropGpuDispatchMs: propStats?.gpuDispatchMs ?? null,
      materialChurnNewMaterials: materialChurnStats.newMaterials,
      materialChurnAssignments: materialChurnStats.materialReplacements,
      materialChurnNeedsUpdate: materialChurnStats.materialNeedsUpdate,
      materialChurnVersionChanges: materialChurnStats.materialVersionChanges,
      materialChurnPipelineSensitiveChanges: materialChurnStats.pipelineSensitiveChanges,
      materialChurnRendererProgramCount: materialChurnStats.rendererProgramCount ?? -1,
      materialChurnRendererProgramDelta: materialChurnStats.rendererProgramDelta ?? 0,
      materialChurnSuspectedPipelineKeyChanges: materialChurnStats.suspectedPipelineKeyChanges,
      dynamicResolutionActive: dynamicResolutionStats?.active ? 1 : 0,
      dynamicResolutionRenderScale: dynamicResolutionStats?.renderScale ?? 0,
      dynamicResolutionAdjustments: dynamicResolutionStats?.adjustments ?? 0,
      gpuPasses: input.gpuPasses ? { ...input.gpuPasses } : undefined,
    });
    if (input.profileEnabled && frameMs >= input.profileFrameMs) {
      console.warn(
        `[profile] frame ${frameMs.toFixed(1)}ms` +
          ` | setup ${input.phaseTiming.frameSetupMs.toFixed(1)}` +
          ` input ${input.phaseTiming.inputMs.toFixed(1)}` +
          ` clodApply ${input.phaseTiming.clodApplyMs.toFixed(1)}` +
          ` selection ${selectionStats.selectionMs.toFixed(1)}` +
          ` (cut ${selectionStats.subphases.cut.toFixed(1)} book ${selectionStats.subphases.book.toFixed(1)} info ${selectionStats.subphases.info.toFixed(1)} overlays ${selectionStats.subphases.overlays.toFixed(1)})` +
          ` bubble/chunks ${bubbleMs.toFixed(1)} (built ${input.chunkGroupsBuiltThisFrame})` +
          ` props ${propsMs.toFixed(1)} (${formatVegetationTiming(input.vegetationTiming, propsMs)})` +
          ` postTerrain shadowProxy ${input.phaseTiming.shadowProxyMs.toFixed(1)}` +
          ` clodShadow ${input.phaseTiming.clodShadowMs.toFixed(1)}` +
          ` canopy ${input.phaseTiming.canopyMs.toFixed(1)}` +
          ` stats ${input.phaseTiming.statsSyncMs.toFixed(1)}` +
          ` rest ${propsUnattributedMs.toFixed(1)}` +
          ` render ${renderMs.toFixed(1)}` +
          ` churn new=${materialChurnStats.newMaterials}` +
          ` needsUpdate=${materialChurnStats.materialNeedsUpdate}` +
          ` programsΔ=${materialChurnStats.rendererProgramDelta ?? 0}` +
          ` other ${otherMs.toFixed(1)}` +
          ` dynScale=${dynamicResolutionStats?.renderScale ?? 0}` +
          ` | cut=${selectionStats.renderedCount} chunkGroups=${input.nearFieldBubbleController.size()} mode=${input.interaction.mode}`,
      );
    }
  }
}
