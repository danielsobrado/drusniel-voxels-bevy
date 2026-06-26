import type * as THREE from "three";
import type { ClodHooks } from "../core/hooks.js";
import { computeEffectiveVisibleMeters, computeVisibleTargetMet } from "../phase0/phase0_metrics.js";
import type { Phase0Config } from "../phase0/phase0_config.js";
import { simulateStreamingCoverage } from "../phase0/streaming_coverage_sim.js";
import type { ClodSelectionStats } from "../terrain/selection/clod_selection_controller.js";
import type { GrassStats } from "../grass.js";
import type { TreeStats } from "../trees/index.js";
import type { StoneStats } from "../stones/stone_instances.js";
import type { DeepOceanRenderConfig } from "../terrain/border_coast_config.js";
import type { WaterField } from "../water/waterField.js";
import { publishBorderOceanAcceptanceCounters } from "../debug/border_ocean_scene.js";
import type { FarShellMetrics } from "../long-view/farShellMetrics.js";
import { publishFarShellMetricsToCounters } from "../long-view/farShellMetrics.js";
import type { FrameRenderer } from "../app/frame_loop/frame_renderer.js";

const PHASE0_P95_WINDOW = 120;

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
  cfg: {
    page: { chunk_size: number; chunks_per_page: number };
  };
  camera: THREE.PerspectiveCamera;
  phase0VelocityX: number;
  phase0VelocityZ: number;
  phase0Streaming: Phase0Config["phase0"]["streaming"];
  borderOceanScene?: {
    waterField: WaterField;
    deepOcean: DeepOceanRenderConfig;
    deepOceanMeshPresent: boolean;
    oceanSampler: import("../water/ocean_service.js").OceanSampler | null;
  };
}

export function createLongViewFrameDiagnostics(deps: LongViewFrameDiagnosticsDeps): () => void {
  const phase0FrameMsBuffer: number[] = [];

  return () => {
    const hooks = deps.getHooks();
    if (!hooks?.stats) return;

    const s = hooks.stats;
    const selectionStats = deps.getSelectionStats();
    s.fps = deps.getAverageFps();
    s.frameMs = performance.now() - deps.getFrameStartMs();
    s.frame++;
    const info = deps.renderer.info;
    s.drawCalls = info?.render.drawCalls ?? 0;
    s.triangles = info?.render.triangles ?? 0;
    for (let lvl = 0; lvl <= deps.maxTerrainLevel; lvl++) {
      s.counters[`built_page_count_lod${lvl}`] = selectionStats.nodesByLod[lvl] ?? 0;
    }
    s.counters["terrain_draw_calls"] = selectionStats.renderedCount;
    s.counters["terrain_triangles"] = selectionStats.triCount;

    const grassStats = deps.getGrassStats();
    if (grassStats) {
      s.counters["gpu_grass_visible"] = grassStats.gpuRingVisibleNear + grassStats.gpuRingVisibleMid
        + grassStats.gpuRingVisibleFar + grassStats.gpuRingVisibleSuper;
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
    const farShellEnabled = infiniteShellActive
      ? Boolean(shellMetrics?.farShellEnabled)
      : legacyShellBuilt;
    const farShellRadiusM = infiniteShellActive && shellMetrics
      ? shellMetrics.farShellOuterM
      : deps.worldCells * deps.getFarShellRadiusFactor();
    const farShellGridRes = infiniteShellActive && shellMetrics
      ? shellMetrics.farShellGridRes
      : 128;

    const effectiveVisible = computeEffectiveVisibleMeters({
      worldCells: deps.worldCells,
      farShellEnabled,
      farShellRadiusM,
    });
    s.counters["effective_far_radius_m"] = farShellRadiusM;
    s.counters["effective_visible_m"] = effectiveVisible;
    s.counters["visible_target_met"] = computeVisibleTargetMet({
      effectiveVisibleM: effectiveVisible,
      targetVisibleM: deps.phase0TargetVisibleM,
    }) ? 1 : 0;
    s.counters["far_shell_enabled"] = farShellEnabled ? 1 : 0;
    s.counters["far_shell_radius_m"] = farShellRadiusM;
    s.counters["far_shell_grid_res"] = farShellGridRes;
    s.counters["far_shell_tris"] = infiniteShellActive && shellMetrics
      ? shellMetrics.farShellTriangles
      : (s.counters["far_shell_tris"] ?? 0);
    if (shellMetrics) {
      publishFarShellMetricsToCounters(s.counters, shellMetrics);
    }
    if (s.counters["shadow_proxy_enabled"] === undefined) {
      s.counters["shadow_proxy_enabled"] = deps.isLongView ? 1 : 0;
    }
    s.counters["shadow_proxy_inert"] = deps.getShadowProxyInert();
    s.counters["canopy_enabled"] = deps.farShellCanopyEnabled() ? 1 : 0;
    for (let lvl = 0; lvl <= deps.maxTerrainLevel; lvl++) {
      s.counters[`rendered_page_count_lod${lvl}`] = selectionStats.nodesByLod[lvl] ?? 0;
    }
    s.counters["rendered_terrain_tris"] = selectionStats.triCount;
    s.counters["total_scene_tris"] = s.triangles;
    s.counters["draw_calls"] = s.drawCalls;
    s.counters["frame_ms_avg"] = s.fps > 0 ? 1000 / s.fps : 0;

    phase0FrameMsBuffer.push(s.frameMs);
    if (phase0FrameMsBuffer.length > PHASE0_P95_WINDOW) phase0FrameMsBuffer.shift();
    if (phase0FrameMsBuffer.length >= 10) {
      const sorted = [...phase0FrameMsBuffer].sort((a, b) => a - b);
      s.counters["frame_ms_p95"] = sorted[Math.floor(sorted.length * 0.95)] ?? -1;
      s.counters["frame_ms_p99"] = sorted[Math.floor(sorted.length * 0.99)] ?? -1;
    }
    s.counters["horizon_hole_ratio"] = -1;

    if (deps.queryScene === "border-ocean" && deps.borderOceanScene) {
      publishBorderOceanAcceptanceCounters(s.counters, {
        worldCells: deps.worldCells,
        deepOcean: deps.borderOceanScene.deepOcean,
        waterField: deps.borderOceanScene.waterField,
        deepOceanMeshPresent: deps.borderOceanScene.deepOceanMeshPresent,
        oceanSampler: deps.borderOceanScene.oceanSampler,
      });
    }

    const streamingReport = simulateStreamingCoverage({
      worldCells: deps.worldCells,
      chunkSize: deps.cfg.page.chunk_size,
      pageSizeCells: deps.cfg.page.chunks_per_page * deps.cfg.page.chunk_size,
      playerX: deps.camera.position.x,
      playerZ: deps.camera.position.z,
      velocityX: deps.phase0VelocityX,
      velocityZ: deps.phase0VelocityZ,
      preloadSeconds: deps.phase0Streaming.preload_seconds,
      liveRadiusM: deps.phase0Streaming.live_radius_m,
      clodRadiusM: deps.phase0Streaming.clod_radius_m,
    });
    s.counters["streamer_simulated_required_chunks"] = streamingReport.requiredChunkCount;
    s.counters["streamer_simulated_required_pages"] = streamingReport.requiredPageCount;
    s.counters["streamer_simulated_missing_chunks"] = streamingReport.missingChunkCount;
    s.counters["streamer_simulated_missing_pages"] = streamingReport.missingPageCount;

    const missingCounters = deps.phase0Config.metrics.required_counters.filter((k) => !(k in s.counters));
    window.__drusnielPhase0Report = {
      scene: deps.queryScene ?? "unknown",
      config_hash: "phase0",
      timestamp: new Date().toISOString(),
      metrics: { ...s.counters },
      required_counters_present: missingCounters.length === 0,
      missing_counters: missingCounters,
    };
  };
}
