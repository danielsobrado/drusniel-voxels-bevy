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
import type { FarShellMetrics } from "../long-view/farShellMetrics.js";
import { resetFrameShellMetrics } from "../long-view/farShellMetrics.js";

export interface FarSummaryIntegrationOptions {
  terrainSampler: FarTerrainSampler;
  scene?: THREE.Scene;
  camera?: THREE.PerspectiveCamera;
  farShellMetrics?: FarShellMetrics;
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

function positiveIntegerParam(params: URLSearchParams, key: string): number | null {
  const parsed = Number(params.get(key));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function currentQueryParams(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export function resolveFarSummaryFrameInterval(
  params: URLSearchParams,
  key: string,
  defaultInterval: number,
): number {
  return Math.max(1, positiveIntegerParam(params, key) ?? defaultInterval);
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

  const queryParams = currentQueryParams();
  // Tile builds are deadline-sliced inside buildSomeTiles (maxBuildMsPerFrame),
  // so per-frame building is frame-safe; the old 30-frame infinite-islands
  // throttle starved the clipmap (~9 ready of ~120 required per scene).
  const buildIntervalFrames = resolveFarSummaryFrameInterval(
    queryParams,
    "farSummaryBuildInterval",
    1,
  );

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
    sampler.setSampleCenter(currentCenter.worldX, currentCenter.worldZ);

    const requests = computeRequiredFarSummaryTiles(currentCenter, config);

    const nowMs = performance.now();

    cache.requestTiles(requests, frameIndex, nowMs);

    const buildAllowedByInterval = frameIndex % buildIntervalFrames === 0;
    const buildAllowedByDelay = buildDelayMs <= 0 || frameIndex % Math.ceil(buildDelayMs / 16) === 0;
    if (buildAllowedByInterval && buildAllowedByDelay) {
      const budget = forceSlowBuilds ? 1 : undefined;
      const buildBudgetMs = Math.max(0, config.stream.maxBuildMsPerFrame);
      const deadlineMs = Number.isFinite(buildBudgetMs) && buildBudgetMs > 0
        ? nowMs + buildBudgetMs
        : Number.POSITIVE_INFINITY;
      cache.buildSomeTiles(options.terrainSampler, frameIndex, nowMs, budget, deadlineMs);
    }

    cache.evictColdTiles(frameIndex, nowMs);

    const currentStats = cache.getStats();
    const requestStates = cache.countRequestStates(requests);
    stats.requestedTiles = currentStats.requestedTiles;
    stats.buildingTiles = currentStats.buildingTiles;
    stats.readyTiles = currentStats.readyTiles;
    stats.staleTiles = currentStats.staleTiles;
    stats.evictedTiles = currentStats.evictedTiles;
    stats.cacheHits = currentStats.cacheHits;
    stats.cacheMisses = currentStats.cacheMisses;
    stats.proceduralFallbacks = currentStats.proceduralFallbacks;
    stats.lowerRingFallbacks = currentStats.lowerRingFallbacks;
    stats.conservativeFallbacks = currentStats.conservativeFallbacks;
    stats.tilesBuiltThisFrame = currentStats.tilesBuiltThisFrame;
    stats.tilesCommittedThisFrame = currentStats.tilesCommittedThisFrame;
    stats.buildTimeMs = currentStats.buildTimeMs;
    stats.maxBuildTimeMs = currentStats.maxBuildTimeMs;
    stats.staleRestores = currentStats.staleRestores;
    stats.buildsDiscarded = currentStats.buildsDiscarded;

    debugOverlay.update(frameIndex, stats);

    if (options.farShellMetrics) {
      const metrics = options.farShellMetrics;
      resetFrameShellMetrics(metrics);
      metrics.farSummaryTilesRequired = requests.length;
      metrics.farSummaryTilesReady = requestStates.ready;
      metrics.farSummaryTilesBuilding = requestStates.building;
      metrics.farSummaryTilesMissing = requestStates.missing;
      metrics.farSummaryTilesStale = requestStates.staleWithSamples;
      metrics.farSummaryTilesBuiltThisFrame = stats.tilesBuiltThisFrame;
      metrics.farSummaryCacheSize = cache.getTileCount();
      metrics.farSummaryProceduralFallbackSamples = stats.proceduralFallbacks;
      metrics.farSummaryLowerRingFallbackSamples = stats.lowerRingFallbacks;
      metrics.farSummaryConservativeFallbackSamples = stats.conservativeFallbacks;
      metrics.farSummaryStaleRestores = stats.staleRestores;
      metrics.farSummaryBuildsDiscarded = stats.buildsDiscarded;
      metrics.farSummaryFallbackSamples =
        stats.proceduralFallbacks +
        stats.lowerRingFallbacks +
        stats.conservativeFallbacks;
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
