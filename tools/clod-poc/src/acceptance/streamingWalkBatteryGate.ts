import type { AcceptanceConfig, AcceptanceFailure, AcceptanceGateResult } from "./acceptanceTypes.js";
import type { ClodPagesConfig } from "../config.js";
import { TerrainOwnershipRuntime } from "../stream/terrain_ownership_runtime.js";
import { computeOwnershipCoverageCounters, type OwnershipCoverageCounters } from "../stream/ownership_coverage_oracle.js";
import { createBiomeTextureStreamingManager } from "../textures/biome_texture_streaming_manager.js";
import { DEFAULT_PROCEDURAL_TEXTURE_CONFIG, MAX_ACTIVE_BIOME_TEXTURES } from "../textures/materialRecipes.js";
import { ProceduralWorldSource } from "../world_source/world_source.js";

interface StreamingWalkAggregate {
  frames: number;
  maxCameraToClodCenterM: number;
  maxCameraToFarShellCenterM: number;
  maxLiveClodGapHoles: number;
  maxClodFarGapHoles: number;
  maxLiveClodOverlapCells: number;
  maxMissingLiveChunks: number;
  maxMissingClodPages: number;
  maxHorizonHoleRatio: number;
  textureWindowSwaps: number;
  maxActiveBiomeTextures: number;
  uniqueActiveBiomeWindows: number;
  lastCounters: OwnershipCoverageCounters;
}

const DEFAULT_SCENE = "infinite-islands-walk-battery";

function routePoint(frame: number, config: AcceptanceConfig): { x: number; z: number } {
  const step = config.streamingWalk.stepM;
  const x = frame * step;
  const z = Math.sin(frame * 0.17) * step * 6 + Math.cos(frame * 0.041) * step * 3;
  return { x, z };
}

// Deterministic procedural world used to drive the biome-texture window from the *real*
// BiomeRegionField (islands enabled, fixed seed) rather than a synthetic biome sequence, so the
// gate proves the actual classifier keeps the active texture window within budget along the route.
const WALK_BATTERY_WORLD_SOURCE = new ProceduralWorldSource({
  seed: 1337,
  islandShape: { enabled: true, oceanRim: false, spacingM: 1500, radiusM: 560, blendM: 260 },
});

function sampleRouteBiome(x: number, z: number): number {
  return WALK_BATTERY_WORLD_SOURCE.sampleBiome(x, z);
}

function failIf(
  failures: AcceptanceFailure[],
  condition: boolean,
  code: string,
  message: string,
  value: number,
  threshold: number,
): void {
  if (!condition) return;
  failures.push({
    code,
    message,
    scene: DEFAULT_SCENE,
    value,
    threshold,
  });
}

function buildRuntime(clodCfg: ClodPagesConfig, config: AcceptanceConfig): TerrainOwnershipRuntime {
  const pageSizeM = clodCfg.page.chunks_per_page * clodCfg.page.chunk_size;
  return new TerrainOwnershipRuntime({
    liveRadiusM: config.streamingWalk.liveRadiusM,
    clodRadiusM: config.streamingWalk.clodRadiusM,
    farShellInnerM: config.streamingWalk.clodRadiusM,
    farShellOuterM: config.streamingWalk.farShellOuterM,
    targetVisibleM: config.streamingWalk.clodRadiusM,
    targetFutureVisibleM: config.streamingWalk.farShellOuterM,
    streamingScene: true,
  }, {
    live: {
      chunkSizeM: clodCfg.page.chunk_size,
      hysteresisM: config.streamingWalk.hysteresisM,
    },
    visualPages: {
      pageSizeM,
      maxLevel: config.streamingWalk.maxClodLevel,
      hysteresisM: config.streamingWalk.hysteresisM,
    },
  });
}

/**
 * Streaming-ownership bookkeeping gate. Walks a deterministic route and asserts the ownership
 * runtime keeps live/CLOD/far-shell footprints gap- and overlap-free, centred on the camera, with
 * the real BiomeRegionField holding the active texture window within budget.
 *
 * Scope: this validates ownership-set *bookkeeping* and the biome/texture windowing logic over a
 * simulated route — it does NOT render frames. It cannot prove the absence of rasterised holes or
 * that GPU frame time stays within budget; those require the in-browser shot/battery harness.
 */
export function runGateA7(
  clodCfg: ClodPagesConfig,
  config: AcceptanceConfig,
): AcceptanceGateResult {
  if (!config.streamingWalk.enabled) {
    return {
      id: "A7",
      name: "Streaming walk battery",
      status: "warn",
      message: "Streaming walk battery disabled in acceptance config.",
      measurements: { enabled: false },
      failures: [],
    };
  }

  const runtime = buildRuntime(clodCfg, config);
  const pageSizeM = clodCfg.page.chunks_per_page * clodCfg.page.chunk_size;
  const activeWindowSignatures = new Set<string>();
  const biomeManager = createBiomeTextureStreamingManager({
    baseConfig: DEFAULT_PROCEDURAL_TEXTURE_CONFIG,
    sampleBiome: sampleRouteBiome,
    probeDistanceM: config.streamingWalk.biomeProbeDistanceM,
    minMoveDistanceM: Math.max(1, config.streamingWalk.stepM * 0.5),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    onActiveWindowChanged: (_nextConfig, activeBiomeMaterials) => {
      activeWindowSignatures.add(activeBiomeMaterials.join("|"));
    },
  });

  let farShellRecenterCount = 0;
  let farShellLastRecenterFrame = -1;
  let lastFarShellCenter: { x: number; z: number } | null = null;
  let aggregate: StreamingWalkAggregate | null = null;

  for (let frame = 0; frame < config.streamingWalk.frames; frame++) {
    const camera = routePoint(frame, config);
    const snapshot = runtime.update(camera);
    const farShellCenter = { ...camera };
    if (!lastFarShellCenter || Math.hypot(farShellCenter.x - lastFarShellCenter.x, farShellCenter.z - lastFarShellCenter.z) > 0) {
      farShellRecenterCount++;
      farShellLastRecenterFrame = frame;
      lastFarShellCenter = farShellCenter;
    }

    biomeManager.update({ x: camera.x, z: camera.z, frameIndex: frame });
    const biomeStats = biomeManager.stats();
    const counters = computeOwnershipCoverageCounters({
      snapshot,
      chunkSizeM: clodCfg.page.chunk_size,
      pageSizeM,
      maxLevel: config.streamingWalk.maxClodLevel,
      camera,
      farShellCenter,
      farShellRecenterCount,
      farShellLastRecenterFrame,
      coverageCellM: config.streamingWalk.coverageCellM,
    });

    if (!aggregate) {
      aggregate = {
        frames: 0,
        maxCameraToClodCenterM: 0,
        maxCameraToFarShellCenterM: 0,
        maxLiveClodGapHoles: 0,
        maxClodFarGapHoles: 0,
        maxLiveClodOverlapCells: 0,
        maxMissingLiveChunks: 0,
        maxMissingClodPages: 0,
        maxHorizonHoleRatio: 0,
        textureWindowSwaps: 0,
        maxActiveBiomeTextures: 0,
        uniqueActiveBiomeWindows: 0,
        lastCounters: counters,
      };
    }

    aggregate.frames++;
    aggregate.maxCameraToClodCenterM = Math.max(aggregate.maxCameraToClodCenterM, counters.camera_to_clod_center_m);
    aggregate.maxCameraToFarShellCenterM = Math.max(aggregate.maxCameraToFarShellCenterM, counters.camera_to_far_shell_center_m);
    aggregate.maxLiveClodGapHoles = Math.max(aggregate.maxLiveClodGapHoles, counters.live_clod_gap_holes);
    aggregate.maxClodFarGapHoles = Math.max(aggregate.maxClodFarGapHoles, counters.clod_far_gap_holes);
    aggregate.maxLiveClodOverlapCells = Math.max(aggregate.maxLiveClodOverlapCells, counters.live_clod_overlap_cells);
    aggregate.maxMissingLiveChunks = Math.max(aggregate.maxMissingLiveChunks, counters.missing_live_chunks_in_required_radius);
    aggregate.maxMissingClodPages = Math.max(aggregate.maxMissingClodPages, counters.missing_clod_pages_in_required_radius);
    aggregate.maxHorizonHoleRatio = Math.max(aggregate.maxHorizonHoleRatio, counters.horizon_hole_ratio);
    aggregate.textureWindowSwaps = biomeStats.textureWindowSwaps;
    aggregate.maxActiveBiomeTextures = Math.max(aggregate.maxActiveBiomeTextures, biomeStats.activeBiomeMaterials.length);
    aggregate.uniqueActiveBiomeWindows = activeWindowSignatures.size;
    aggregate.lastCounters = counters;
  }

  const result = aggregate ?? {
    frames: 0,
    maxCameraToClodCenterM: Number.POSITIVE_INFINITY,
    maxCameraToFarShellCenterM: Number.POSITIVE_INFINITY,
    maxLiveClodGapHoles: Number.POSITIVE_INFINITY,
    maxClodFarGapHoles: Number.POSITIVE_INFINITY,
    maxLiveClodOverlapCells: Number.POSITIVE_INFINITY,
    maxMissingLiveChunks: Number.POSITIVE_INFINITY,
    maxMissingClodPages: Number.POSITIVE_INFINITY,
    maxHorizonHoleRatio: Number.POSITIVE_INFINITY,
    textureWindowSwaps: 0,
    maxActiveBiomeTextures: 0,
    uniqueActiveBiomeWindows: 0,
    lastCounters: {
      camera_to_clod_center_m: 0,
      camera_to_far_shell_center_m: 0,
      far_shell_inner_minus_clod_radius_m: 0,
      live_clod_gap_holes: 0,
      clod_far_gap_holes: 0,
      live_clod_overlap_cells: 0,
      clod_far_overlap_cells: 0,
      missing_live_chunks_in_required_radius: 0,
      missing_clod_pages_in_required_radius: 0,
      far_shell_recenter_count: 0,
      far_shell_last_recenter_frame: -1,
      ring_boundary_holes: 0,
      horizon_hole_ratio: 0,
    },
  };

  const failures: AcceptanceFailure[] = [];
  failIf(failures, result.frames !== config.streamingWalk.frames, "STREAMING_WALK_FRAME_COUNT", "Streaming walk did not execute the configured frame count.", result.frames, config.streamingWalk.frames);
  failIf(failures, result.maxCameraToClodCenterM > config.streamingWalk.maxCenterDriftM, "STREAMING_CLOD_CENTER_DRIFT", "CLOD center drifted away from the camera.", result.maxCameraToClodCenterM, config.streamingWalk.maxCenterDriftM);
  failIf(failures, result.maxCameraToFarShellCenterM > config.streamingWalk.maxCenterDriftM, "STREAMING_FAR_CENTER_DRIFT", "Far shell center drifted away from the camera.", result.maxCameraToFarShellCenterM, config.streamingWalk.maxCenterDriftM);
  failIf(failures, result.maxLiveClodGapHoles > config.streamingWalk.maxGapHoles, "STREAMING_LIVE_CLOD_GAP", "Live/CLOD ownership gap holes detected during walk.", result.maxLiveClodGapHoles, config.streamingWalk.maxGapHoles);
  failIf(failures, result.maxClodFarGapHoles > config.streamingWalk.maxGapHoles, "STREAMING_CLOD_FAR_GAP", "CLOD/far-shell ownership gap holes detected during walk.", result.maxClodFarGapHoles, config.streamingWalk.maxGapHoles);
  failIf(failures, result.maxLiveClodOverlapCells > config.streamingWalk.maxOverlapCells, "STREAMING_LIVE_CLOD_OVERLAP", "Live/CLOD ownership overlap cells detected during walk.", result.maxLiveClodOverlapCells, config.streamingWalk.maxOverlapCells);
  failIf(failures, result.maxMissingLiveChunks > 0, "STREAMING_MISSING_LIVE_CHUNKS", "Required live chunks were missing during walk.", result.maxMissingLiveChunks, 0);
  failIf(failures, result.maxMissingClodPages > 0, "STREAMING_MISSING_CLOD_PAGES", "Required CLOD pages were missing during walk.", result.maxMissingClodPages, 0);
  failIf(failures, result.maxHorizonHoleRatio > config.streamingWalk.maxHorizonHoleRatio, "STREAMING_HORIZON_HOLES", "Horizon boundary holes exceeded threshold during walk.", result.maxHorizonHoleRatio, config.streamingWalk.maxHorizonHoleRatio);
  failIf(failures, result.maxActiveBiomeTextures > Math.min(config.streamingWalk.maxActiveBiomeTextures, MAX_ACTIVE_BIOME_TEXTURES), "STREAMING_BIOME_TEXTURE_WINDOW", "Active biome texture window exceeded the two-biome cap.", result.maxActiveBiomeTextures, Math.min(config.streamingWalk.maxActiveBiomeTextures, MAX_ACTIVE_BIOME_TEXTURES));

  const status = failures.length > 0 ? "fail" : "pass";
  return {
    id: "A7",
    name: "Streaming walk battery",
    status,
    message: status === "pass"
      ? `Streaming walk passed ${result.frames} frames with ${result.textureWindowSwaps} texture-window swaps.`
      : `${failures.length} streaming walk acceptance failure(s).`,
    measurements: {
      enabled: true,
      frames: result.frames,
      maxCameraToClodCenterM: result.maxCameraToClodCenterM,
      maxCameraToFarShellCenterM: result.maxCameraToFarShellCenterM,
      maxLiveClodGapHoles: result.maxLiveClodGapHoles,
      maxClodFarGapHoles: result.maxClodFarGapHoles,
      maxLiveClodOverlapCells: result.maxLiveClodOverlapCells,
      maxMissingLiveChunks: result.maxMissingLiveChunks,
      maxMissingClodPages: result.maxMissingClodPages,
      maxHorizonHoleRatio: result.maxHorizonHoleRatio,
      farShellRecenterCount: result.lastCounters.far_shell_recenter_count,
      farShellLastRecenterFrame: result.lastCounters.far_shell_last_recenter_frame,
      textureWindowSwaps: result.textureWindowSwaps,
      maxActiveBiomeTextures: result.maxActiveBiomeTextures,
      uniqueActiveBiomeWindows: result.uniqueActiveBiomeWindows,
      maxCenterDriftM_threshold: config.streamingWalk.maxCenterDriftM,
      maxGapHoles_threshold: config.streamingWalk.maxGapHoles,
      maxOverlapCells_threshold: config.streamingWalk.maxOverlapCells,
      maxHorizonHoleRatio_threshold: config.streamingWalk.maxHorizonHoleRatio,
      maxActiveBiomeTextures_threshold: Math.min(config.streamingWalk.maxActiveBiomeTextures, MAX_ACTIVE_BIOME_TEXTURES),
    },
    failures,
  };
}
