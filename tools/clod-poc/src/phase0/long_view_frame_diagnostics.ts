import type * as THREE from "three";
import type { CamPose, ClodHooks } from "../core/hooks.js";
import { computeEffectiveVisibleMeters, computeVisibleTargetMet } from "../phase0/phase0_metrics.js";
import type { Phase0Config } from "../phase0/phase0_config.js";
import { simulateStreamingCoverage } from "../phase0/streaming_coverage_sim.js";
import type { ClodSelectionStats } from "../terrain/selection/clod_selection_controller.js";
import type { FarClipmapOwnershipSnapshot } from "../terrain/far_clipmap/index.js";
import type { GrassStats } from "../grass.js";
import type { TreeStats } from "../trees/index.js";
import type { StoneStats } from "../stones/stone_instances.js";
import type { DeepOceanRenderConfig } from "../terrain/border_coast_config.js";
import type { PlayerConfig } from "../player_controller.js";
import type { WaterField } from "../water/waterField.js";
import { publishBorderOceanAcceptanceCounters } from "../debug/border_ocean_scene.js";
import type { FarShellMetrics } from "../long-view/farShellMetrics.js";
import { publishFarShellMetricsToCounters } from "../long-view/farShellMetrics.js";
import type { FrameRenderer } from "../app/frame_loop/frame_renderer.js";
import type { TerrainOwnershipRuntime, TerrainOwnershipRuntimeSnapshot } from "../stream/terrain_ownership_runtime.js";
import { publishOwnershipRuntimeCounters } from "../stream/ownership_counters.js";
import { computeOwnershipCoverageCounters, publishOwnershipCoverageCounters } from "../stream/ownership_coverage_oracle.js";
import type { OwnershipResidencyFeeds } from "../stream/ownership_residency.js";
import { countSnapshotResidencyMissing, createSnapshotOwnershipResidencyFeeds, pageCoveredByResidentClodHierarchy } from "../stream/ownership_residency.js";
import { parsePageKey } from "../stream/page_plan.js";

const PHASE0_P95_WINDOW = 120;
const PERF_DIAGNOSTICS_CAMERA_EPSILON_M = 1;
const HEAVY_DIAGNOSTICS_MIN_INTERVAL_MS = 1_000;
const HEAVY_DIAGNOSTICS_SOFT_FRAME_DEADLINE_MS = 8;

export interface LongViewFrameDiagnosticsDeps {
  getHooks: () => ClodHooks | null;
  getAverageFps: () => number;
  getFrameStartMs: () => number;
  renderer: FrameRenderer;
  getSelectionStats: () => ClodSelectionStats;
  maxTerrainLevel: number;
  getGrassStats: () => GrassStats | null;
  getTreeStats: () => TreeStats | null;
  getStoneStats: () => StoneStats | null;
  worldCells: number;
  getFarShellRadiusFactor: () => number;
  farShellBuilt: () => boolean;
  farShellCanopyEnabled: () => boolean;
  getFarShellMetrics?: () => FarShellMetrics | undefined;
  infiniteFarShellActive?: () => boolean;
  isLongView: boolean;
  getShadowProxyInert: () => number;
  getShadowProxyEnabled: () => number;
  phase0TargetVisibleM: number;
  phase0Config: Phase0Config;
  queryScene: string | null;
  cfg: { page: { chunk_size: number; chunks_per_page: number } };
  camera: THREE.PerspectiveCamera;
  phase0VelocityX: number;
  phase0VelocityZ: number;
  phase0Streaming: Phase0Config["phase0"]["streaming"];
  ownershipRuntime: TerrainOwnershipRuntime;
  /** Canonical streaming center (player / orbit target); falls back to the camera eye. */
  getWorldCenter?: () => { x: number; z: number } | null;
  getOwnershipResidencyFeeds?: () => OwnershipResidencyFeeds;
  getFarClipmapOwnershipSnapshot?: () => FarClipmapOwnershipSnapshot | undefined;
  borderOceanScene?: {
    waterField: WaterField;
    deepOcean: DeepOceanRenderConfig;
    deepOceanMeshPresent: boolean;
    oceanSampler: import("../water/ocean_service.js").OceanSampler | null;
    playerConfig: Readonly<PlayerConfig>;
  };
}

export interface StreamReadinessCounters {
  farSummaryTilesRequired: number;
  farSummaryTilesReady: number;
  farSummaryTilesMissing: number;
  farSummaryTilesBuilding: number;
  streamRequiredPages: number;
  streamSafetyPendingPages: number;
  streamSafetyInflightPages: number;
  streamParentCoverageViolations: number;
  streamActiveRootPages: number;
}

export function requiredRootClodPagesReady(
  snapshot: TerrainOwnershipRuntimeSnapshot,
  feeds: OwnershipResidencyFeeds,
  requiredRootLevel: number,
  coverageMaxLevel: number,
): boolean {
  const ready = feeds.clodReady();
  for (const key of snapshot.visualPages.required) {
    const page = parsePageKey(key);
    if (page.level !== requiredRootLevel) continue;
    if (!pageCoveredByResidentClodHierarchy(page, ready, coverageMaxLevel)) return false;
  }
  return true;
}

export function streamReadinessSatisfied(input: {
  snapshot: TerrainOwnershipRuntimeSnapshot;
  feeds: OwnershipResidencyFeeds;
  requiredRootLevel: number;
  coverageMaxLevel: number;
  liveMissing: number;
  counters: StreamReadinessCounters;
}): boolean {
  const farSummaryReady = input.counters.farSummaryTilesRequired <= 0
    || (
      input.counters.farSummaryTilesMissing === 0
      && input.counters.farSummaryTilesBuilding === 0
      && input.counters.farSummaryTilesReady >= input.counters.farSummaryTilesRequired
    );
  const streamSafetyReady = input.counters.streamRequiredPages <= 0
    || (
      input.counters.streamSafetyPendingPages === 0
      && input.counters.streamSafetyInflightPages === 0
      && input.counters.streamParentCoverageViolations === 0
      && input.counters.streamActiveRootPages > 0
    );
  return input.liveMissing === 0 && streamSafetyReady && farSummaryReady;
}

function farClipmapFromCounters(counters: Readonly<Record<string, number>>, camera: THREE.PerspectiveCamera): FarClipmapOwnershipSnapshot | undefined {
  if (counters["far_clipmap_enabled"] !== 1) return undefined;
  const innerRadiusM = counters["far_clipmap_inner_radius_m"];
  const outerRadiusM = counters["far_clipmap_outer_radius_m"];
  if (!Number.isFinite(innerRadiusM) || !Number.isFinite(outerRadiusM)) return undefined;
  return {
    enabled: true,
    innerRadiusM,
    outerRadiusM,
    centerX: camera.position.x,
    centerZ: camera.position.z,
    snapX: camera.position.x,
    snapZ: camera.position.z,
    ready: (counters["far_clipmap_pending_tiles"] ?? 1) === 0 && (counters["far_clipmap_ready_tiles"] ?? 0) > 0,
  };
}

export function createLongViewFrameDiagnostics(deps: LongViewFrameDiagnosticsDeps): () => void {
  const phase0FrameMsBuffer: number[] = [];
  const streamingScene = deps.queryScene?.startsWith("infinite-") ?? false;
  let farShellRecenterCount = 0;
  let farShellLastRecenterFrame = -1;
  let lastFarShellSnapX = Number.NaN;
  let lastFarShellSnapZ = Number.NaN;
  let backgroundQuiet = false;
  let streamReadyFrame = -1;
  let lastFullDiagnosticsCameraX = Number.NaN;
  let lastFullDiagnosticsCameraZ = Number.NaN;
  let lastFullDiagnosticsReady = false;

  const resetFrameMetrics = (): void => {
    phase0FrameMsBuffer.length = 0;
    const hooks = deps.getHooks();
    if (!hooks?.stats) return;
    hooks.stats.counters["frame_ms_avg"] = 0;
    hooks.stats.counters["frame_ms_p95"] = -1;
    hooks.stats.counters["frame_ms_p99"] = -1;
  };

  const numericCounter = (counters: Readonly<Record<string, number>>, key: string, fallback: number): number => {
    const value = counters[key];
    return Number.isFinite(value) ? value : fallback;
  };

  const liveSafetyRadiusM = (): number => Math.max(0, deps.phase0Streaming.live_radius_m - deps.cfg.page.chunks_per_page * deps.cfg.page.chunk_size);

  const requiredStreamingRootLevel = (counters: Readonly<Record<string, number>>): number => Math.max(
    0,
    Math.min(deps.maxTerrainLevel, Math.floor(numericCounter(counters, "live_clod_stream_max_root_level", deps.maxTerrainLevel))),
  );

  // Reuse-mode acceptance swaps URL flags via history.replaceState without a reload (e.g. the
  // perf gate turns the ownership oracle off after a coverage-gate page load), so the flags can
  // change mid-session; re-parse only when the search string actually changes.
  let resolvedFlagsSearch: string | null = null;
  let ownershipOracleActive = false;
  let acceptancePerfDiagnosticsActive = false;
  // Acceptance/QA harnesses gate on these counters per frame; interactive runs only need them at
  // HUD cadence, and the streaming simulation + ownership scans are too heavy for every frame.
  let perFrameHeavyDiagnostics = false;
  const resolveUrlFlags = (): void => {
    const search = typeof window === "undefined" ? "" : window.location.search;
    if (search === resolvedFlagsSearch) return;
    resolvedFlagsSearch = search;
    const params = new URLSearchParams(search);
    ownershipOracleActive = (params.get("acceptance") === "1" && params.get("ownershipOracle") !== "0") || params.get("ownershipOracle") === "1";
    acceptancePerfDiagnosticsActive = params.get("acceptance") === "1" && params.get("ownershipOracle") === "0";
    perFrameHeavyDiagnostics = params.get("acceptance") === "1" || params.get("qa") === "1" || params.get("ownershipOracle") === "1";
  };
  resolveUrlFlags();
  let lastHeavyDiagnosticsMs = -Infinity;

  const ownershipOracleEnabled = (): boolean => ownershipOracleActive;

  const acceptancePerfDiagnosticsEnabled = (): boolean => acceptancePerfDiagnosticsActive;

  const backgroundQueuesQuiet = (counters: Readonly<Record<string, number>>): boolean => {
    const tilesMissing = numericCounter(counters, "far_summary_tiles_missing", -1);
    const tilesBuilding = numericCounter(counters, "far_summary_tiles_building", -1);
    const farShellRebuildPending = numericCounter(counters, "far_shell_rebuild_pending", 0);
    const textureWindowPending = numericCounter(counters, "terrain_texture_window_pending", 0);
    const bubbleRequired = numericCounter(counters, "live_bubble_required_pages", -1);
    const bubbleBuilding = numericCounter(counters, "live_bubble_building_pages", -1);
    const bubbleReady = numericCounter(counters, "live_bubble_ready_pages", -1);
    const bubbleFailed = numericCounter(counters, "live_bubble_failed_pages", -1);
    const proxyBuilding = numericCounter(counters, "shadow_proxy_building", 0);
    const streamRequired = numericCounter(counters, "live_clod_stream_required_pages", 0);
    const streamPending = numericCounter(counters, "live_clod_stream_pending_pages", 0);
    const streamInflight = numericCounter(counters, "live_clod_stream_inflight_batches", 0);
    const streamReady = numericCounter(counters, "live_clod_stream_ready_pages", 0);
    const streamSafetyPending = numericCounter(counters, "live_clod_stream_safety_pending_pages", streamPending);
    const streamSafetyInflight = numericCounter(counters, "live_clod_stream_safety_inflight_pages", streamInflight);
    const streamParentCoverageViolations = numericCounter(counters, "live_clod_stream_parent_coverage_violations", streamReady > 0 ? 0 : 1);
    const streamActiveRootPages = numericCounter(counters, "live_clod_stream_active_root_pages", streamReady);
    const farClipmapPending = numericCounter(counters, "far_clipmap_pending_tiles", 0);
    const farSummaryQuiet = tilesMissing === 0 && tilesBuilding === 0 && farClipmapPending === 0;
    const bubbleQuiet = bubbleRequired === 0 || (bubbleFailed === 0 && bubbleBuilding === 0 && bubbleReady > 0);
    const streamQuiet = streamRequired === 0 || (
      streamSafetyPending === 0
      && streamSafetyInflight === 0
      && streamParentCoverageViolations === 0
      && streamActiveRootPages > 0
    );
    return farSummaryQuiet && farShellRebuildPending === 0 && textureWindowPending === 0 && bubbleQuiet && streamQuiet && proxyBuilding !== 1;
  };

  const resetDiagnosticsReuse = (): void => {
    lastFullDiagnosticsCameraX = Number.NaN;
    lastFullDiagnosticsCameraZ = Number.NaN;
    lastFullDiagnosticsReady = false;
  };

  const canReusePerfDiagnostics = (counters: Readonly<Record<string, number>>): boolean => {
    if (!acceptancePerfDiagnosticsEnabled()) return false;
    if (streamReadyFrame < 0 || !backgroundQuiet || !lastFullDiagnosticsReady) return false;
    if (!backgroundQueuesQuiet(counters)) return false;
    const dx = deps.camera.position.x - lastFullDiagnosticsCameraX;
    const dz = deps.camera.position.z - lastFullDiagnosticsCameraZ;
    return Math.hypot(dx, dz) <= PERF_DIAGNOSTICS_CAMERA_EPSILON_M;
  };

  if (typeof window !== "undefined") {
    // Copying ~900 counters into a fresh report object every frame is wasted work between harness
    // reads; expose the report as a getter that materializes from the live counters on access.
    Object.defineProperty(window, "__drusnielPhase0Report", {
      configurable: true,
      get: () => {
        const counters = deps.getHooks()?.stats?.counters;
        if (!counters) return undefined;
        const missingCounters = deps.phase0Config.metrics.required_counters.filter((k) => !(k in counters));
        return {
          scene: deps.queryScene ?? "unknown",
          config_hash: "phase0",
          timestamp: new Date().toISOString(),
          metrics: { ...counters },
          required_counters_present: missingCounters.length === 0,
          missing_counters: missingCounters,
        };
      },
    });
    const resetAcceptanceScene = (): void => {
      streamReadyFrame = -1;
      backgroundQuiet = false;
      resetDiagnosticsReuse();
      resetFrameMetrics();
      const hooks = deps.getHooks();
      if (hooks?.stats) hooks.stats.counters["stream_ready_frame"] = -1;
    };
    const resetAcceptanceSceneForPose = (pose: CamPose): void => {
      const hooks = deps.getHooks();
      if (typeof hooks?.setPose === "function") hooks.setPose(pose);
      resetAcceptanceScene();
    };
    (window as typeof window & { __drusnielResetPhase0FrameStats?: () => void }).__drusnielResetPhase0FrameStats = resetFrameMetrics;
    const hooks = window.__drusnielClod;
    if (hooks) hooks.resetAcceptanceScene = resetAcceptanceScene;
    if (hooks) hooks.resetAcceptanceSceneForPose = resetAcceptanceSceneForPose;
  }

  return () => {
    const hooks = deps.getHooks();
    if (!hooks?.stats) return;
    resolveUrlFlags();

    const s = hooks.stats;
    const selectionStats = deps.getSelectionStats();
    s.fps = deps.getAverageFps();
    s.frameMs = performance.now() - deps.getFrameStartMs();
    s.frame++;
    const info = deps.renderer.info;
    s.drawCalls = info?.render.drawCalls ?? 0;
    s.triangles = info?.render.triangles ?? 0;
    for (let lvl = 0; lvl <= deps.maxTerrainLevel; lvl++) s.counters[`built_page_count_lod${lvl}`] = selectionStats.nodesByLod[lvl] ?? 0;
    s.counters["terrain_draw_calls"] = selectionStats.renderedCount;
    s.counters["terrain_triangles"] = selectionStats.triCount;

    const grassStats = deps.getGrassStats();
    if (grassStats) {
      s.counters["gpu_grass_visible"] = grassStats.gpuRingVisibleNear + grassStats.gpuRingVisibleMid + grassStats.gpuRingVisibleFar + grassStats.gpuRingVisibleSuper;
      s.counters["gpu_grass_dispatch_ms"] = grassStats.gpuRingDispatchMs ?? 0;
    }
    const treeStats = deps.getTreeStats();
    if (treeStats) {
      s.counters["gpu_tree_visible"] = treeStats.gpuVisibleCount;
      s.counters["gpu_tree_dispatch_ms"] = treeStats.gpuDispatchMs ?? 0;
    }
    const stoneStats = deps.getStoneStats();
    if (stoneStats) {
      s.counters["gpu_stone_visible"] = stoneStats.visible;
      s.counters["gpu_stone_drawn_near"] = stoneStats.drawnNear;
      s.counters["gpu_stone_drawn_far"] = stoneStats.drawnFar;
    }

    const shellMetrics = deps.getFarShellMetrics?.();
    const infiniteShellActive = deps.infiniteFarShellActive?.() ?? false;
    const legacyShellBuilt = deps.farShellBuilt();
    const farShellEnabled = infiniteShellActive ? Boolean(shellMetrics?.farShellEnabled) : legacyShellBuilt;
    const farShellRadiusM = infiniteShellActive && shellMetrics ? shellMetrics.farShellOuterM : deps.worldCells * deps.getFarShellRadiusFactor();
    const farShellGridRes = infiniteShellActive && shellMetrics ? shellMetrics.farShellGridRes : 128;

    const effectiveVisible = computeEffectiveVisibleMeters({ worldCells: deps.worldCells, farShellEnabled, farShellRadiusM });
    s.counters["effective_far_radius_m"] = farShellRadiusM;
    s.counters["effective_visible_m"] = effectiveVisible;
    s.counters["visible_target_met"] = computeVisibleTargetMet({ effectiveVisibleM: effectiveVisible, targetVisibleM: deps.phase0TargetVisibleM }) ? 1 : 0;
    s.counters["far_shell_enabled"] = farShellEnabled ? 1 : 0;
    s.counters["far_shell_radius_m"] = farShellRadiusM;
    s.counters["far_shell_grid_res"] = farShellGridRes;
    s.counters["far_shell_tris"] = infiniteShellActive && shellMetrics ? shellMetrics.farShellTriangles : (s.counters["far_shell_tris"] ?? 0);
    if (shellMetrics) publishFarShellMetricsToCounters(s.counters, shellMetrics);
    if (s.counters["shadow_proxy_enabled"] === undefined) s.counters["shadow_proxy_enabled"] = deps.isLongView ? 1 : 0;
    s.counters["shadow_proxy_inert"] = deps.getShadowProxyInert();
    s.counters["canopy_enabled"] = deps.farShellCanopyEnabled() ? 1 : 0;
    for (let lvl = 0; lvl <= deps.maxTerrainLevel; lvl++) s.counters[`rendered_page_count_lod${lvl}`] = selectionStats.nodesByLod[lvl] ?? 0;
    s.counters["rendered_terrain_tris"] = selectionStats.triCount;
    s.counters["total_scene_tris"] = s.triangles;
    s.counters["draw_calls"] = s.drawCalls;

    phase0FrameMsBuffer.push(s.frameMs);
    if (phase0FrameMsBuffer.length > PHASE0_P95_WINDOW) phase0FrameMsBuffer.shift();
    if (phase0FrameMsBuffer.length > 0) s.counters["frame_ms_avg"] = phase0FrameMsBuffer.reduce((sum, value) => sum + value, 0) / phase0FrameMsBuffer.length;
    if (phase0FrameMsBuffer.length >= 10) {
      const sorted = [...phase0FrameMsBuffer].sort((a, b) => a - b);
      s.counters["frame_ms_p95"] = sorted[Math.floor(sorted.length * 0.95)] ?? -1;
      s.counters["frame_ms_p99"] = sorted[Math.floor(sorted.length * 0.99)] ?? -1;
    }
    if (deps.queryScene === "border-ocean" && deps.borderOceanScene) {
      publishBorderOceanAcceptanceCounters(s.counters, {
        worldCells: deps.worldCells,
        deepOcean: deps.borderOceanScene.deepOcean,
        waterField: deps.borderOceanScene.waterField,
        deepOceanMeshPresent: deps.borderOceanScene.deepOceanMeshPresent,
        oceanSampler: deps.borderOceanScene.oceanSampler,
        playerConfig: deps.borderOceanScene.playerConfig,
      });
    }

    if (canReusePerfDiagnostics(s.counters)) {
      s.counters["ownership_oracle_ms"] = 0;
      s.counters["long_view_diagnostics_reused_frames"] = (s.counters["long_view_diagnostics_reused_frames"] ?? 0) + 1;
      return;
    }
    const nowMs = performance.now();
    if (!perFrameHeavyDiagnostics && nowMs - deps.getFrameStartMs() >= HEAVY_DIAGNOSTICS_SOFT_FRAME_DEADLINE_MS) {
      s.counters["long_view_diagnostics_budget_deferred_frames"] = (s.counters["long_view_diagnostics_budget_deferred_frames"] ?? 0) + 1;
      return;
    }
    if (!perFrameHeavyDiagnostics && nowMs - lastHeavyDiagnosticsMs < HEAVY_DIAGNOSTICS_MIN_INTERVAL_MS) {
      s.counters["long_view_diagnostics_throttled_frames"] = (s.counters["long_view_diagnostics_throttled_frames"] ?? 0) + 1;
      return;
    }
    lastHeavyDiagnosticsMs = nowMs;
    s.counters["long_view_diagnostics_full_frames"] = (s.counters["long_view_diagnostics_full_frames"] ?? 0) + 1;

    const streamCenter = deps.getWorldCenter?.() ?? { x: deps.camera.position.x, z: deps.camera.position.z };
    const streamingReport = simulateStreamingCoverage({
      worldCells: deps.worldCells,
      chunkSize: deps.cfg.page.chunk_size,
      pageSizeCells: deps.cfg.page.chunks_per_page * deps.cfg.page.chunk_size,
      playerX: streamCenter.x,
      playerZ: streamCenter.z,
      velocityX: deps.phase0VelocityX,
      velocityZ: deps.phase0VelocityZ,
      preloadSeconds: deps.phase0Streaming.preload_seconds,
      liveRadiusM: deps.phase0Streaming.live_radius_m,
      clodRadiusM: deps.phase0Streaming.clod_refinement_radius_m ?? deps.phase0Streaming.clod_radius_m,
      infiniteStreaming: streamingScene,
    });
    s.counters["streamer_simulated_required_chunks"] = streamingReport.requiredChunkCount;
    s.counters["streamer_simulated_required_pages"] = streamingReport.requiredPageCount;
    s.counters["streamer_simulated_missing_chunks"] = streamingReport.missingChunkCount;
    s.counters["streamer_simulated_missing_pages"] = streamingReport.missingPageCount;

    const ownershipSnapshot = deps.ownershipRuntime.update({ x: streamCenter.x, z: streamCenter.z });
    publishOwnershipRuntimeCounters(s.counters, ownershipSnapshot);
    const ownershipResidencyFeeds = deps.getOwnershipResidencyFeeds?.() ?? createSnapshotOwnershipResidencyFeeds(ownershipSnapshot);
    const rootLevel = requiredStreamingRootLevel(s.counters);
    const residencyMissing = countSnapshotResidencyMissing(ownershipSnapshot, ownershipResidencyFeeds, {
      liveChunkSizeM: deps.cfg.page.chunk_size,
      liveRequiredRadiusM: liveSafetyRadiusM(),
      clodRequiredRootLevel: rootLevel,
      clodCoverageMaxLevel: deps.maxTerrainLevel,
    });
    s.counters["residency_missing_live"] = residencyMissing.liveMissing;
    s.counters["residency_missing_clod"] = residencyMissing.clodMissing;
    if (streamReadyFrame < 0 && streamReadinessSatisfied({
      snapshot: ownershipSnapshot,
      feeds: ownershipResidencyFeeds,
      requiredRootLevel: rootLevel,
      coverageMaxLevel: deps.maxTerrainLevel,
      liveMissing: residencyMissing.liveMissing,
      counters: {
        farSummaryTilesRequired: numericCounter(s.counters, "far_summary_tiles_required", 0),
        farSummaryTilesReady: numericCounter(s.counters, "far_summary_tiles_ready", 0),
        farSummaryTilesMissing: numericCounter(s.counters, "far_summary_tiles_missing", 0),
        farSummaryTilesBuilding: numericCounter(s.counters, "far_summary_tiles_building", 0),
        streamRequiredPages: numericCounter(s.counters, "live_clod_stream_required_pages", 0),
        streamSafetyPendingPages: numericCounter(s.counters, "live_clod_stream_safety_pending_pages", 0),
        streamSafetyInflightPages: numericCounter(s.counters, "live_clod_stream_safety_inflight_pages", 0),
        streamParentCoverageViolations: numericCounter(s.counters, "live_clod_stream_parent_coverage_violations", 0),
        streamActiveRootPages: numericCounter(s.counters, "live_clod_stream_active_root_pages", 0),
      },
    })) streamReadyFrame = s.frame;
    s.counters["stream_ready_frame"] = streamReadyFrame;

    const farClipmap = deps.getFarClipmapOwnershipSnapshot?.() ?? farClipmapFromCounters(s.counters, deps.camera);
    const farShellCenter = shellMetrics ? { x: shellMetrics.farShellCenterX, z: shellMetrics.farShellCenterZ } : { x: deps.camera.position.x, z: deps.camera.position.z };
    const farShellSnapX = shellMetrics?.farShellSnappedX ?? farShellCenter.x;
    const farShellSnapZ = shellMetrics?.farShellSnappedZ ?? farShellCenter.z;
    if (farShellSnapX !== lastFarShellSnapX || farShellSnapZ !== lastFarShellSnapZ) {
      farShellRecenterCount++;
      farShellLastRecenterFrame = s.frame;
      lastFarShellSnapX = farShellSnapX;
      lastFarShellSnapZ = farShellSnapZ;
    }
    if (ownershipOracleEnabled()) {
      const ownershipOracleStartMs = performance.now();
      const ownershipCoverageCounters = computeOwnershipCoverageCounters({
        snapshot: ownershipSnapshot,
        chunkSizeM: deps.cfg.page.chunk_size,
        pageSizeM: deps.cfg.page.chunks_per_page * deps.cfg.page.chunk_size,
        maxLevel: deps.maxTerrainLevel,
        requiredRootLevel: rootLevel,
        liveRequiredRadiusM: liveSafetyRadiusM(),
        camera: { x: deps.camera.position.x, z: deps.camera.position.z },
        farShellCenter,
        farShellRecenterCount,
        farShellLastRecenterFrame,
        farClipmap,
        residencyFeeds: ownershipResidencyFeeds,
      });
      publishOwnershipCoverageCounters(s.counters, ownershipCoverageCounters);
      s.counters["ownership_oracle_ms"] = performance.now() - ownershipOracleStartMs;
    } else {
      s.counters["ownership_oracle_ms"] = 0;
      publishOwnershipCoverageCounters(s.counters, {
        camera_to_clod_center_m: Math.hypot(deps.camera.position.x - ownershipSnapshot.center.x, deps.camera.position.z - ownershipSnapshot.center.z),
        camera_to_far_shell_center_m: Math.hypot(deps.camera.position.x - (farClipmap?.centerX ?? farShellCenter.x), deps.camera.position.z - (farClipmap?.centerZ ?? farShellCenter.z)),
        far_shell_inner_minus_clod_radius_m: (farClipmap?.innerRadiusM ?? ownershipSnapshot.farShell.innerRadiusM) - ownershipSnapshot.ownership.clodRadiusM,
        live_clod_gap_holes: 0,
        clod_far_gap_holes: 0,
        live_clod_overlap_cells: 0,
        clod_far_overlap_cells: 0,
        raw_live_clod_overlap_cells: 0,
        raw_clod_far_overlap_cells: 0,
        missing_live_chunks_in_required_radius: s.counters["residency_missing_live"],
        missing_clod_pages_in_required_radius: s.counters["residency_missing_clod"],
        far_shell_recenter_count: farShellRecenterCount,
        far_shell_last_recenter_frame: farShellLastRecenterFrame,
        ring_boundary_holes: s.counters["residency_missing_live"] + s.counters["residency_missing_clod"],
        horizon_hole_ratio: 0,
        raw_horizon_hole_ratio: 0,
        priority_owner_overlap_cells: 0,
        priority_unowned_cells: 0,
        clod_parent_coverage_violations: s.counters["residency_missing_clod"],
        far_clipmap_owned_cells: farClipmap?.ready ? numericCounter(s.counters, "far_clipmap_gpu_owned_cells", 0) : 0,
        far_clipmap_unowned_cells: farClipmap?.enabled && !farClipmap.ready ? 1 : 0,
        far_clipmap_ownership_holes: 0,
        far_clipmap_priority_overlap_cells: 0,
        owner_far_clipmap_cells: farClipmap?.ready ? numericCounter(s.counters, "far_clipmap_gpu_owned_cells", 0) : 0,
        owner_clod_refinement_cells: 0,
        owner_live_cells: 0,
      });
    }

    const nowQuiet = backgroundQueuesQuiet(s.counters);
    if (nowQuiet && !backgroundQuiet) {
      resetFrameMetrics();
      s.counters["phase0_frame_metrics_resets"] = (s.counters["phase0_frame_metrics_resets"] ?? 0) + 1;
    }
    backgroundQuiet = nowQuiet;
    if (nowQuiet) {
      lastFullDiagnosticsCameraX = deps.camera.position.x;
      lastFullDiagnosticsCameraZ = deps.camera.position.z;
      lastFullDiagnosticsReady = true;
    } else {
      resetDiagnosticsReuse();
    }

    const inflightMs = s.counters["live_clod_stream_inflight_ms"] ?? 0;
    const isAcceptance = typeof window !== "undefined" && (window.location.search.includes("acceptance") || window.location.search.includes("qa"));
    const timeoutThresholdMs = isAcceptance ? 300000 : 60000;
    if (inflightMs > timeoutThresholdMs) {
      const hooks = (window as typeof window & { __drusnielClod?: { error?: string | null } }).__drusnielClod;
      if (hooks) hooks.error = `Streamed CLOD worker build timed out after ${inflightMs.toFixed(0)}ms (inflight batch exceeded ${timeoutThresholdMs / 1000}s threshold)`;
    }
  };
}
