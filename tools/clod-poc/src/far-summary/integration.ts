import * as THREE from "three";
import { DEFAULT_FAR_SUMMARY_CONFIG, type FarSummaryConfig } from "./config.js";
import { FarSummaryCache } from "./summary-cache.js";
import { FarSummaryClipmapSampler } from "./clipmap-sampler.js";
import type { FarTerrainSampler } from "./summary-tile-builder.js";
import { updateStreamCenter, type StreamCenter } from "./stream-center.js";
import { computeRequiredFarSummaryTiles } from "./clipmap-rings.js";
import { FarSummaryDebugOverlay } from "./debug-overlay.js";
import { createFarSummaryStats } from "./stats.js";
import type { FarSummaryStats } from "./types.js";
import type { FarHeightProvider } from "./clipmap-sampler.js";
import type { FarShellController } from "../systems/far_shell_controller.js";

export interface FarSummaryIntegrationOptions {
  terrainSampler: FarTerrainSampler;
  scene?: THREE.Scene;
  camera?: THREE.PerspectiveCamera;
  farShellController?: FarShellController;
  config?: Partial<FarSummaryConfig>;
}

export interface FarSummaryIntegration {
  readonly cache: FarSummaryCache;
  readonly sampler: FarSummaryClipmapSampler;
  readonly debugOverlay: FarSummaryDebugOverlay;
  readonly stats: FarSummaryStats;

  update: (frameIndex: number, deltaSeconds: number, camera: THREE.PerspectiveCamera) => void;
  getHeightProvider: () => FarHeightProvider;
  getStreamCenter: () => StreamCenter;
  setForceSlowBuilds: (on: boolean) => void;
  setBuildDelayMs: (ms: number) => void;
  dispose: () => void;
}

export function initFarSummaryIntegration(
  options: FarSummaryIntegrationOptions,
): FarSummaryIntegration {
  const config: FarSummaryConfig = {
    ...DEFAULT_FAR_SUMMARY_CONFIG,
    ...options.config,
    stream: { ...DEFAULT_FAR_SUMMARY_CONFIG.stream, ...(options.config?.stream ?? {}) },
    sampling: { ...DEFAULT_FAR_SUMMARY_CONFIG.sampling, ...(options.config?.sampling ?? {}) },
    debug: { ...DEFAULT_FAR_SUMMARY_CONFIG.debug, ...(options.config?.debug ?? {}) },
    rings: options.config?.rings ?? DEFAULT_FAR_SUMMARY_CONFIG.rings,
  };

  const cache = new FarSummaryCache(config);
  const sampler = new FarSummaryClipmapSampler(cache, config, options.terrainSampler);
  const debugOverlay = new FarSummaryDebugOverlay(config, cache, options.scene);
  const stats = createFarSummaryStats();

  let frameIndex = 0;
  let previousCenter: StreamCenter | null = null;
  let currentCenter: StreamCenter = {
    worldX: 0, worldZ: 0,
    predictedX: 0, predictedZ: 0,
    velocityX: 0, velocityZ: 0,
  };
  let forceSlowBuilds = false;
  let buildDelayMs = 0;

  const update = (_frameIndexArg: number, deltaSeconds: number, camera: THREE.PerspectiveCamera) => {
    frameIndex++;

    currentCenter = updateStreamCenter(
      camera.position,
      previousCenter,
      deltaSeconds,
      config.stream.preloadSeconds,
    );
    previousCenter = currentCenter;

    const requests = computeRequiredFarSummaryTiles(currentCenter, config);

    const nowMs = performance.now();

    cache.requestTiles(requests, frameIndex, nowMs);

    if (buildDelayMs > 0 && frameIndex % Math.ceil(buildDelayMs / 16) !== 0) {
    } else {
      const budget = forceSlowBuilds ? 1 : undefined;
      cache.buildSomeTiles(options.terrainSampler, frameIndex, nowMs, budget);
    }

    cache.markStale(null);
    cache.evictColdTiles(frameIndex, nowMs);

    const currentStats = cache.getStats();
    // Carry over cumulative counters, replace per-frame ones.
    stats.requestedTiles = currentStats.requestedTiles;
    stats.buildingTiles = currentStats.buildingTiles;
    stats.readyTiles = currentStats.readyTiles;
    stats.staleTiles = currentStats.staleTiles;
    stats.evictedTiles = currentStats.evictedTiles;
    stats.cacheHits = currentStats.cacheHits;
    stats.cacheMisses = currentStats.cacheMisses;
    stats.proceduralFallbacks = currentStats.proceduralFallbacks;
    stats.lowerRingFallbacks = currentStats.lowerRingFallbacks;
    stats.tilesBuiltThisFrame = currentStats.tilesBuiltThisFrame;
    stats.tilesCommittedThisFrame = currentStats.tilesCommittedThisFrame;
    stats.buildTimeMs = currentStats.buildTimeMs;
    stats.maxBuildTimeMs = currentStats.maxBuildTimeMs;

    debugOverlay.update(frameIndex, stats);

    if (options.farShellController) {
      options.farShellController.moveTo(
        currentCenter.predictedX,
        currentCenter.predictedZ,
      );
    }
  };

  const getHeightProvider = (): FarHeightProvider => sampler;

  const integration: FarSummaryIntegration = {
    cache,
    sampler,
    debugOverlay,
    stats,
    update,
    getHeightProvider,
    getStreamCenter: () => currentCenter,
    setForceSlowBuilds: (on: boolean) => { forceSlowBuilds = on; },
    setBuildDelayMs: (ms: number) => { buildDelayMs = ms; },
    dispose: () => {
      debugOverlay.dispose();
    },
  };

  (window as unknown as Record<string, unknown>).__drusnielFarSummary = integration;

  return integration;
}

declare global {
  interface Window {
    __drusnielFarSummary?: FarSummaryIntegration;
  }
}
