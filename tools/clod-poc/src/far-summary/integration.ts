import * as THREE from "three";
import type { TerrainFieldConfig } from "../terrain/terrain.js";
import { DEFAULT_FAR_CLIPMAP_CONFIG } from "../terrain/far_clipmap/far_clipmap_config.js";
import {
  DEFAULT_FAR_SUMMARY_CONFIG,
  resolveFarSummaryBuildBudgets,
  resolveFarSummaryEnrichmentBudgetMs,
  type FarSummaryConfig,
  type FarSummaryRingConfig,
} from "./config.js";
import { FarSummaryCache } from "./summary-cache.js";
import { FarSummaryClipmapSampler } from "./clipmap-sampler.js";
import {
  createFarSummaryUnifiedEnrichment,
  stepFarSummaryUnifiedEnrichment,
  stepFarSummaryUnifiedWaterEnrichment,
  takeFarSummaryUnifiedWaterSnapshot,
  type FarSummaryUnifiedEnrichmentState,
  type FarTerrainSampler,
} from "./summary-tile-builder.js";
import { updateStreamCenter, type StreamCenter } from "./stream-center.js";
import { computeRequiredFarSummaryTiles, type FarSummaryRingRequest } from "./clipmap-rings.js";
import { FarSummaryDebugOverlay } from "./debug-overlay.js";
import { createFarSummaryStats } from "./stats.js";
import type { FarSummaryStats } from "./types.js";
import type { FarHeightProvider } from "./clipmap-sampler.js";
import { farSummaryGpuConfigFromParams, farSummaryGpuDefaultsForScene } from "./gpu-config.js";
import { FarSummaryGpuRuntime } from "./gpu-runtime.js";
import type { FarSummaryGpuRuntimeStats } from "./gpu-runtime.js";
import type { FarShellMetrics } from "../long-view/farShellMetrics.js";
import { resetFrameShellMetrics } from "../long-view/farShellMetrics.js";
import type { FarSummaryGpuAtlasView } from "../naadf/gpu/farSummaryAtlas.js";
import { getActiveWebGpuRendererContext } from "../rendering/webgpu_renderer_context.js";
import {
  createFarSummaryGpuRenderAtlasRuntime,
  setActiveFarSummaryGpuAtlasView,
} from "./gpu-render-atlas.js";
import {
  createFarSummaryBaseSampler,
  FarSummaryCpuBaseBuilder,
  requestKey,
} from "./cpu-unified-builder.js";
import {
  countFarSummaryUnifiedReadiness,
  type FarSummaryUnifiedReadiness,
} from "./unified-readiness.js";

const INFINITE_ISLANDS_SCENE = "infinite-islands";

export interface FarSummaryIntegrationOptions {
  terrainSampler: FarTerrainSampler;
  terrainFieldConfig?: TerrainFieldConfig;
  sharedDevice?: GPUDevice | null;
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

  update: (frameIndex: number, deltaSeconds: number, camera: THREE.PerspectiveCamera, streamCenter?: { x: number; z: number }) => void;
  getHeightProvider: () => FarHeightProvider;
  getGpuAtlasView: () => FarSummaryGpuAtlasView | undefined;
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
  pendingEnrichmentKeys: { has(key: string): boolean } = new Set(),
): FarSummaryRingRequest[] {
  const dirty: FarSummaryRingRequest[] = [];
  const seen = new Set<string>();
  for (const request of requests) {
    const key = requestKey(request);
    if (seen.has(key)) continue;
    seen.add(key);
    if (pendingEnrichmentKeys.has(key)) continue;
    const tile = cache.getTile(request.key);
    if (!tile || tile.state === "missing" || tile.state === "requested" || tile.state === "stale" || tile.state === "cooling" || tile.state === "evicted") {
      dirty.push(request);
    }
  }
  return dirty;
}

export function prunePendingGpuEnrichment<T>(
  requests: readonly FarSummaryRingRequest[],
  pending: Map<string, T>,
  onPruned?: (value: T) => void,
): number {
  const required = new Set(requests.map(requestKey));
  let removed = 0;
  for (const key of pending.keys()) {
    if (required.has(key)) continue;
    onPruned?.(pending.get(key)!);
    pending.delete(key);
    removed++;
  }
  return removed;
}

function pruneCpuFallbackKeys(
  cache: FarSummaryCache,
  requests: readonly FarSummaryRingRequest[],
  keys: Set<string>,
): void {
  const required = new Map(requests.map((request) => [requestKey(request), request]));
  for (const key of keys) {
    const request = required.get(key);
    if (!request) {
      keys.delete(key);
      continue;
    }
    const tile = cache.getTile(request.key);
    if (tile?.state === "ready" && tile.samples.length > 0) keys.delete(key);
  }
}

export function initFarSummaryIntegration(
  options: FarSummaryIntegrationOptions,
): FarSummaryIntegration {
  const queryParams = currentQueryParams();
  const unifiedLayout = queryParams.get("farSummaryLayout") === "2";
  const configuredRings = options.config?.rings ?? DEFAULT_FAR_SUMMARY_CONFIG.rings;
  const config: FarSummaryConfig = applyFarSummaryQueryOverrides({
    ...DEFAULT_FAR_SUMMARY_CONFIG,
    ...options.config,
    stream: { ...DEFAULT_FAR_SUMMARY_CONFIG.stream, ...(options.config?.stream ?? {}) },
    sampling: { ...DEFAULT_FAR_SUMMARY_CONFIG.sampling, ...(options.config?.sampling ?? {}) },
    debug: { ...DEFAULT_FAR_SUMMARY_CONFIG.debug, ...(options.config?.debug ?? {}) },
    rings: farSummaryRingsForScene(queryParams, configuredRings),
  }, queryParams);
  const gpuConfig = farSummaryGpuConfigFromParams(queryParams, farSummaryGpuDefaultsForScene(queryParams));

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
  let authoritativeCpuFallbackFramesTotal = 0;
  const pendingCpuFallbackKeys = new Set<string>();
  const pendingUnifiedEnrichment = new Map<string, FarSummaryUnifiedEnrichmentState>();
  const baseTerrainSampler = unifiedLayout
    ? createFarSummaryBaseSampler(options.terrainSampler)
    : options.terrainSampler;
  const cpuBaseBuilder = new FarSummaryCpuBaseBuilder({
    config,
    cache,
    terrainSampler: baseTerrainSampler,
    isEnrichmentPending: (key) => pendingUnifiedEnrichment.has(key),
    onBuilt: (key, tile) => {
      pendingCpuFallbackKeys.delete(key);
      pendingUnifiedEnrichment.set(key, createFarSummaryUnifiedEnrichment(tile));
    },
  });
  const pendingUnifiedKeys = {
    has: (key: string) =>
      pendingUnifiedEnrichment.has(key) || pendingCpuFallbackKeys.has(key) || cpuBaseBuilder.has(key),
  };

  const originalMarkStale = cache.markStale.bind(cache);
  cache.markStale = (bounds) => {
    cpuBaseBuilder.reset();
    pendingCpuFallbackKeys.clear();
    pendingUnifiedEnrichment.clear();
    originalMarkStale(bounds);
  };

  const gpuRuntime = new FarSummaryGpuRuntime({
    gpuConfig,
    farSummaryConfig: config,
    terrainSampler: options.terrainSampler,
    terrainFieldConfig: options.terrainFieldConfig,
    sharedDevice: options.sharedDevice,
    commitTile: (tile) => {
      if (!unifiedLayout) {
        cache.commitExternalTile(tile);
        return;
      }
      const key = `${tile.key.ring}:${tile.key.x}:${tile.key.z}:${tile.key.cellSizeM}`;
      pendingCpuFallbackKeys.delete(key);
      pendingUnifiedEnrichment.set(key, createFarSummaryUnifiedEnrichment(tile));
    },
    onFallbackRequests: (requests) => {
      for (const request of requests) pendingCpuFallbackKeys.add(requestKey(request));
    },
  });

  if (queryParams.get("scene") === INFINITE_ISLANDS_SCENE) setActiveFarSummaryGpuAtlasView(undefined);
  const rendererContext = queryParams.get("scene") === INFINITE_ISLANDS_SCENE
    && queryParams.get("farShellGpuAtlas") !== "0"
    ? getActiveWebGpuRendererContext()
    : null;
  const gpuRenderAtlas = rendererContext
    ? createFarSummaryGpuRenderAtlasRuntime({
        renderer: rendererContext.renderer,
        device: rendererContext.device,
        config,
        terrainFieldConfig: options.terrainFieldConfig,
      })
    : null;
  if (gpuRenderAtlas) setActiveFarSummaryGpuAtlasView(gpuRenderAtlas.view);

  let frameIndex = 0;
  let previousCenter: StreamCenter | null = null;
  let currentCenter: StreamCenter = {
    worldX: 0, worldZ: 0,
    predictedX: 0, predictedZ: 0,
    velocityX: 0, velocityZ: 0,
  };
  let forceSlowBuilds = false;
  let buildDelayMs = 0;

  const update = (_frameIndexArg: number, deltaSeconds: number, camera: THREE.PerspectiveCamera, streamCenter?: { x: number; z: number }) => {
    frameIndex++;

    // Prefer the canonical world center (player / orbit target) so far tiles stay concentric
    // with the near bubble and streamed CLOD pages; the camera eye drifts away in orbit mode.
    currentCenter = updateStreamCenter(
      streamCenter ?? camera.position,
      previousCenter,
      deltaSeconds,
      config.stream.preloadSeconds,
    );
    const gpuDirtyReason = previousCenter ? "camera_ring_shift" : "startup";
    previousCenter = currentCenter;
    sampler.setSampleCenter(currentCenter.worldX, currentCenter.worldZ);
    gpuRenderAtlas?.update(currentCenter, frameIndex);

    const requests = computeRequiredFarSummaryTiles(currentCenter, config);
    const nowMs = performance.now();

    cache.requestTiles(requests, frameIndex, nowMs);
    prunePendingGpuEnrichment(
      requests,
      pendingUnifiedEnrichment,
      (enrichment) => cache.discardDeferredTile(enrichment.tile.key),
    );
    pruneCpuFallbackKeys(cache, requests, pendingCpuFallbackKeys);
    const preBuildStates = cache.countRequestStates(requests);
    const requiredCount =
      preBuildStates.ready + preBuildStates.building + preBuildStates.staleWithSamples + preBuildStates.missing;
    const readyRatio = requiredCount > 0 ? preBuildStates.ready / requiredCount : 1;
    const budgets = resolveFarSummaryBuildBudgets(config.stream, readyRatio, forceSlowBuilds);
    const gpuDirtyRequests = gpuConfig.enabled
      ? gpuDirtyRequestsForCache(cache, requests, pendingUnifiedKeys)
      : [];

    const buildAllowedByInterval = frameIndex % buildIntervalFrames === 0;
    const buildAllowedByDelay = buildDelayMs <= 0 || frameIndex % Math.ceil(buildDelayMs / 16) === 0;
    const authoritativeGpu = gpuConfig.enabled && gpuConfig.authoritative;
    const cpuFallbackRequests = authoritativeGpu
      ? requests.filter((request) => pendingCpuFallbackKeys.has(requestKey(request)))
      : requests;
    const cpuFallbackAllowed = !authoritativeGpu
      || cpuFallbackRequests.length > 0
      || cpuBaseBuilder.buildingCount() > 0;
    const cpuBuildSuppressedByGpuAuthority = authoritativeGpu && !cpuFallbackAllowed;
    if (cpuFallbackAllowed && buildAllowedByInterval && buildAllowedByDelay) {
      const deadlineMs = Number.isFinite(budgets.budgetMs) && budgets.budgetMs > 0
        ? nowMs + budgets.budgetMs
        : Number.POSITIVE_INFINITY;
      if (unifiedLayout) {
        cpuBaseBuilder.buildSome(cpuFallbackRequests, frameIndex, nowMs, budgets.maxBuilds, deadlineMs);
      } else {
        cache.buildSomeTiles(options.terrainSampler, frameIndex, nowMs, budgets.maxBuilds, deadlineMs);
      }
    }
    if (authoritativeGpu && (cpuFallbackRequests.length > 0 || cpuBaseBuilder.buildingCount() > 0)) {
      authoritativeCpuFallbackFramesTotal++;
    }

    gpuRuntime.update(currentCenter, frameIndex, gpuDirtyReason, gpuDirtyRequests, cpuBuildSuppressedByGpuAuthority);

    // Terrain and water become sampleable before canopy refinement. Both GPU and CPU base tiles
    // use this same queue, so fallback behavior cannot regress to monolithic per-cell enrichment.
    const enrichmentBudgetMs = resolveFarSummaryEnrichmentBudgetMs(budgets);
    const enrichmentDeadlineMs = performance.now() + enrichmentBudgetMs;
    for (const enrichment of pendingUnifiedEnrichment.values()) {
      if (enrichment.nextSample >= enrichment.tile.samples.length) continue;
      if (stepFarSummaryUnifiedWaterEnrichment(enrichment, options.terrainSampler, enrichmentDeadlineMs)
        && options.terrainSampler.sampleCanopySummary) {
        const waterSnapshot = takeFarSummaryUnifiedWaterSnapshot(enrichment);
        if (waterSnapshot) cache.commitExternalTile(waterSnapshot);
      }
      if (performance.now() >= enrichmentDeadlineMs) break;
    }
    if (performance.now() < enrichmentDeadlineMs) {
      for (const [key, enrichment] of pendingUnifiedEnrichment) {
        if (enrichment.nextSample < enrichment.tile.samples.length) continue;
        const complete = stepFarSummaryUnifiedEnrichment(enrichment, options.terrainSampler, enrichmentDeadlineMs);
        if (complete) {
          cache.commitExternalTile(enrichment.tile);
          pendingUnifiedEnrichment.delete(key);
        }
        if (performance.now() >= enrichmentDeadlineMs) break;
      }
    }

    cache.evictColdTiles(frameIndex, nowMs);

    let currentStats = cache.getStats();
    const requestStates = cache.countRequestStates(requests);
    const unifiedReadiness = unifiedLayout
      ? countFarSummaryUnifiedReadiness(cache, requests, pendingUnifiedEnrichment, cpuBaseBuilder)
      : legacyReadiness(requestStates.ready);
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
      metrics.farSummaryTerrainWaterReady = unifiedReadiness.terrainWaterReady;
      metrics.farSummaryWaterPending = unifiedReadiness.waterPending;
      metrics.farSummaryCanopyPending = unifiedReadiness.canopyPending;
      metrics.farSummaryFullyEnriched = unifiedReadiness.fullyEnriched;
      metrics.farSummaryFallbackSamples =
        stats.proceduralFallbacks +
        stats.lowerRingFallbacks +
        stats.conservativeFallbacks;
    }

    cache.resetFallbackCounters();
    publishFarSummaryRuntimeCounters({
      fallbackFrames: authoritativeCpuFallbackFramesTotal,
      gpuEnabled: gpuConfig.enabled,
      gpuAuthoritative: gpuConfig.authoritative,
      cpuBaseBuilding: cpuBaseBuilder.buildingCount(),
      cpuBaseTilesTotal: cpuBaseBuilder.completedBaseTilesTotal(),
      readiness: unifiedReadiness,
    });
  };

  const getHeightProvider = (): FarHeightProvider => sampler;
  const integration: FarSummaryIntegration = {
    cache,
    sampler,
    debugOverlay,
    stats,
    update,
    getHeightProvider,
    getGpuAtlasView: () => gpuRenderAtlas?.view,
    getStreamCenter: () => currentCenter,
    getGpuRuntimeStats: () => gpuRuntime.stats(),
    setForceSlowBuilds: (on) => { forceSlowBuilds = on; },
    setBuildDelayMs: (ms) => { buildDelayMs = ms; },
    dispose: () => {
      cpuBaseBuilder.reset();
      pendingCpuFallbackKeys.clear();
      pendingUnifiedEnrichment.clear();
      gpuRenderAtlas?.dispose();
      gpuRuntime.dispose();
      debugOverlay.dispose();
    },
  };

  return integration;
}

export function farSummaryRingsForScene(
  params: URLSearchParams,
  rings: readonly FarSummaryRingConfig[],
): FarSummaryRingConfig[] {
  if (params.get("scene") !== "continent" || params.get("farSummaryLayout") !== "2") {
    return [...rings];
  }
  const queryInnerRadius = Number(params.get("farClipmapInnerRadius"));
  const innerRadiusM = Number.isFinite(queryInnerRadius) && queryInnerRadius > 0
    ? queryInnerRadius
    : DEFAULT_FAR_CLIPMAP_CONFIG.innerRadiusM;
  return rings.map((ring, index) => index === 0
    ? { ...ring, startM: Math.min(ring.startM, innerRadiusM) }
    : ring);
}

interface RuntimeCounterInput {
  fallbackFrames: number;
  gpuEnabled: boolean;
  gpuAuthoritative: boolean;
  cpuBaseBuilding: number;
  cpuBaseTilesTotal: number;
  readiness: FarSummaryUnifiedReadiness;
}

function publishFarSummaryRuntimeCounters(input: RuntimeCounterInput): void {
  const counters = (globalThis as typeof globalThis & {
    window?: { __drusnielClod?: { stats?: { counters?: Record<string, number> } } };
  }).window?.__drusnielClod?.stats?.counters;
  if (!counters) return;

  counters.far_summary_cpu_fallback_frames = input.fallbackFrames;
  counters.far_summary_gpu_enabled = input.gpuEnabled ? 1 : 0;
  counters.far_summary_gpu_authoritative = input.gpuAuthoritative ? 1 : 0;
  counters.far_summary_cpu_base_building = input.cpuBaseBuilding;
  counters.far_summary_cpu_base_tiles_total = input.cpuBaseTilesTotal;
  counters.far_summary_terrain_water_ready = input.readiness.terrainWaterReady;
  counters.far_summary_water_pending = input.readiness.waterPending;
  counters.far_summary_canopy_pending = input.readiness.canopyPending;
  counters.far_summary_fully_enriched = input.readiness.fullyEnriched;
}

function legacyReadiness(ready: number): FarSummaryUnifiedReadiness {
  return {
    terrainWaterReady: ready,
    waterPending: 0,
    canopyPending: 0,
    fullyEnriched: ready,
  };
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
