import * as THREE from "three";
import type { TerrainFieldConfig } from "../terrain/terrain.js";
import { DEFAULT_FAR_SUMMARY_CONFIG, type FarSummaryConfig } from "./config.js";
import { FarSummaryCache } from "./summary-cache.js";
import { FarSummaryClipmapSampler } from "./clipmap-sampler.js";
import type { FarTerrainSampler } from "./summary-tile-builder.js";
import { updateStreamCenter, type StreamCenter } from "./stream-center.js";
import { computeRequiredFarSummaryTiles, type FarSummaryRingRequest } from "./clipmap-rings.js";
import { FarSummaryDebugOverlay } from "./debug-overlay.js";
import { createFarSummaryStats } from "./stats.js";
import type { FarSummaryStats } from "./types.js";
import type { FarHeightProvider } from "./clipmap-sampler.js";
import { farSummaryGpuConfigFromParams } from "./gpu-config.js";
import { FarSummaryGpuRuntime } from "./gpu-runtime.js";
import type { FarSummaryGpuRuntimeStats } from "./gpu-runtime.js";
import type { FarShellMetrics } from "../long-view/farShellMetrics.js";
import { resetFrameShellMetrics } from "../long-view/farShellMetrics.js";

export interface FarSummaryIntegrationOptions {
  terrainSampler: FarTerrainSampler;
  terrainFieldConfig?: TerrainFieldConfig;
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
  getGpuRuntimeStats: () => FarSummaryGpuRuntimeStats;
  setForceSlowBuilds: (on: boolean) => void;
  setBuildDelayMs: (ms: number) => void;
  dispose: () => void;
}

function positiveIntegerParam(params: URLSearchParams, key: string): number | null {
  const parsed = Number(params.get(key));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function positiveNumberParam(params: URLSearchParams, key: string): number | null {
  const parsed = Number(params.get(key));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function currentQueryParams(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export function applyFarSummaryQueryOverrides(config: FarSummaryConfig, params: URLSearchParams): FarSummaryConfig {
  const maxTileBuilds = positiveIntegerParam(params, "farSummaryMaxTileBuildsPerFrame");
  const maxBuildMs = positiveNumberParam(params, "farSummaryMaxBuildMsPerFrame");
  return {
    ...config,
    stream: {
      ...config.stream,
      maxTileBuildsPerFrame: maxTileBuilds ?? config.stream.maxTileBuildsPerFrame,
      maxBuildMsPerFrame: maxBuildMs ?? config.stream.maxBuildMsPerFrame,
    },
  };
}

export function resolveFarSummaryFrameInterval(
  params: URLSearchParams,
  key: string,
  defaultInterval: number,
): number {
  return Math.max(1, positiveIntegerParam(params, key) ?? defaultInterval);
}

function shouldRunFarSummaryProbes(params: URLSearchParams): boolean {
  return (params.get("acceptance") === "1" && params.get("ownershipOracle") !== "0")
    || params.get("ownershipOracle") === "1";
}

function gpuDirtyRequestsForCache(
  cache: FarSummaryCache,
  requests: readonly FarSummaryRingRequest[],
): FarSummaryRingRequest[] {
  const dirty: FarSummaryRingRequest[] = [];
  const seen = new Set<string>();
  for (const request of requests) {
    const key = `${request.key.ring}:${request.key.x}:${request.key.z}:${request.key.cellSizeM}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const tile = cache.getTile(request.key);
    if (!tile || tile.state === "missing" || tile.state === "requested" || tile.state === "stale" || tile.state === "cooling" || tile.state === "evicted") {
      dirty.push(request);
    }
  }
  return dirty;
}

export function initFarSummaryIntegration(
  options: FarSummaryIntegrationOptions,
): FarSummaryIntegration {
  const queryParams = currentQueryParams();
  const config: FarSummaryConfig = applyFarSummaryQueryOverrides({
    ...DEFAULT_FAR_SUMMARY_CONFIG,
    ...options.config,
    stream: { ...DEFAULT_FAR_SUMMARY_CONFIG.stream, ...(options.config?.stream ?? {}) },
    sampling: { ...DEFAULT_FAR_SUMMARY_CONFIG.sampling, ...(options.config?.sampling ?? {}) },
    debug: { ...DEFAULT_FAR_SUMMARY_CONFIG.debug, ...(options.config?.debug ?? {}) },
    rings: options.config?.rings ?? DEFAULT_FAR_SUMMARY_CONFIG.rings,
  }, queryParams);
  const gpuConfig = farSummaryGpuConfigFromParams(queryParams);

  const runProbeDiagnostics = shouldRunFarSummaryProbes(queryParams);
  const buildIntervalFrames = resolveFarSummaryFrameInterval(
    queryParams,
    "farSummaryBuildInterval",
    1,
  );

  const cache = new FarSummaryCache(config);
  const sampler = new FarSummaryClipmapSampler(cache, config, options.terrainSampler);
  const debugOverlay = new FarSummaryDebugOverlay(config, cache, options.scene);
  const stats = createFarSummaryStats();
  const gpuRuntime = new FarSummaryGpuRuntime({
    gpuConfig,
    farSummaryConfig: config,
    terrainSampler: options.terrainSampler,
    terrainFieldConfig: options.terrainFieldConfig,
    commitTile: (tile) => cache.commitExternalTile(tile),
  });

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
    const gpuDirtyReason = previousCenter ? "camera_ring_shift" : "startup";
    previousCenter = currentCenter;
    sampler.setSampleCenter(currentCenter.worldX, currentCenter.worldZ);

    const requests = computeRequiredFarSummaryTiles(currentCenter, config);

    const nowMs = performance.now();

    cache.requestTiles(requests, frameIndex, nowMs);
    const gpuDirtyRequests = gpuDirtyRequestsForCache(cache, requests);

    const buildAllowedByInterval = frameIndex % buildIntervalFrames === 0;
    const buildAllowedByDelay = buildDelayMs <= 0 || frameIndex % Math.ceil(buildDelayMs / 16) === 0;
    const cpuBuildSuppressedByGpuAuthority = gpuConfig.enabled && gpuConfig.authoritative;
    if (!cpuBuildSuppressedByGpuAuthority && buildAllowedByInterval && buildAllowedByDelay) {
      const budget = forceSlowBuilds ? 1 : undefined;
      const buildBudgetMs = Math.max(0, config.stream.maxBuildMsPerFrame);
      const deadlineMs = Number.isFinite(buildBudgetMs) && buildBudgetMs > 0
        ? nowMs + buildBudgetMs
        : Number.POSITIVE_INFINITY;
      cache.buildSomeTiles(options.terrainSampler, frameIndex, nowMs, budget, deadlineMs);
    }

    gpuRuntime.update(currentCenter, frameIndex, gpuDirtyReason, gpuDirtyRequests, cpuBuildSuppressedByGpuAuthority);

    cache.evictColdTiles(frameIndex, nowMs);

    let currentStats = cache.getStats();
    const requestStates = cache.countRequestStates(requests);
    let probeFallbacks = 0;
    let probeHeightErrorMaxM = 0;
    if (options.farShellMetrics && runProbeDiagnostics) {
      const beforeProbe = currentStats;
      const probe = runFarSummaryProbes(sampler, config, options.terrainSampler, currentCenter);
      currentStats = cache.getStats();
      probeFallbacks =
        currentStats.proceduralFallbacks +
        currentStats.lowerRingFallbacks +
        currentStats.conservativeFallbacks -
        beforeProbe.proceduralFallbacks -
        beforeProbe.lowerRingFallbacks -
        beforeProbe.conservativeFallbacks;
      probeHeightErrorMaxM = probe.heightErrorMaxM;
    }
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
      metrics.farSummaryProbeFallbacks = probeFallbacks;
      metrics.farSummaryProbeHeightErrorMaxM = probeHeightErrorMaxM;
      metrics.farSummaryFallbackSamples =
        stats.proceduralFallbacks +
        stats.lowerRingFallbacks +
        stats.conservativeFallbacks;
    }

    cache.resetFallbackCounters();
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
    getGpuRuntimeStats: () => gpuRuntime.stats(),
    setForceSlowBuilds: (on) => { forceSlowBuilds = on; },
    setBuildDelayMs: (ms) => { buildDelayMs = ms; },
    dispose: () => {
      gpuRuntime.dispose();
      debugOverlay.dispose();
    },
  };

  return integration;
}

interface FarSummaryProbeResult {
  samples: number;
  missing: number;
  heightErrorMaxM: number;
}

function runFarSummaryProbes(
  sampler: FarSummaryClipmapSampler,
  config: FarSummaryConfig,
  terrainSampler: FarTerrainSampler,
  center: StreamCenter,
): FarSummaryProbeResult {
  const probes = [
    [0.65, 0],
    [-0.65, 0],
    [0, 0.65],
    [0, -0.65],
  ];
  let missing = 0;
  let heightErrorMaxM = 0;
  const ring = config.rings[0];
  const radius = ring ? (ring.startM + ring.endM) * 0.5 : Math.max(512, config.targetVisibleM * 0.5);
  for (const [dx, dz] of probes) {
    const x = center.worldX + dx * radius;
    const z = center.worldZ + dz * radius;
    const summary = sampler.sampleHeight(x, z);
    const procedural = terrainSampler.sampleHeight(x, z);
    if (!Number.isFinite(summary)) missing++;
    heightErrorMaxM = Math.max(heightErrorMaxM, Math.abs(summary - procedural));
  }
  return { samples: probes.length, missing, heightErrorMaxM };
}
