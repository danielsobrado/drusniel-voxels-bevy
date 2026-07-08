import * as THREE from "three";
import type { FarHeightProvider } from "../far-summary/clipmap-sampler.js";
import type { NaadfFarShellHeightSamplingMode, NaadfPocConfig, NaadfTraversalMode } from "./config.js";
import { isValidFarSummaryAtlasFormat, isValidNaadfGpuAtlasWindowTiles, parseNaadfPocConfig } from "./config.js";
import { NaadfMetricsCollector } from "./metrics.js";
import { createTerrainSource, type TerrainProfile } from "./terrainSource.js";
import {
  createNaadfWorldState,
  updateSummaryStreaming,
  type NaadfWorldState,
} from "./summaryStreamer.js";
import { queryTerrainHeight, tracePrimaryDebugRay, traceSunVisibility } from "./query.js";
import { NaadfDebugOverlay } from "./debugOverlay.js";
import { runAcceptanceChecks, allAcceptancePassed } from "./validation.js";
import { setNaadfIntegration } from "./canopyBridge.js";
import { FarSummaryGpuAtlas, type FarSummaryGpuAtlasView } from "./gpu/farSummaryAtlas.js";
import {
  farSummaryAtlasUploadFallbackReasonCode,
  farSummaryAtlasUploadModeCode,
} from "./farSummaryAtlasUploadCounters.js";
import { registerNaadfSaveInvalidationTarget } from "./invalidation.js";
import terrainMaterialCacheYaml from "../../config/terrain_material_cache.yaml?raw";
import {
  parseTerrainMaterialCacheConfig,
  TERRAIN_MATERIAL_CACHE_DEBUG_CHANNELS,
} from "../terrain/material-cache/terrainMaterialCacheConfig.js";
import { TerrainMaterialCache } from "../terrain/material-cache/terrainMaterialCache.js";
import { terrainMaterialCacheCountersForHud } from "../terrain/material-cache/terrainMaterialDebug.js";

const TRAVERSAL_MODES: ReadonlySet<NaadfTraversalMode> = new Set(["dense", "hdda", "compare"]);
const HEIGHT_MODES: ReadonlySet<NaadfFarShellHeightSamplingMode> = new Set(["gpu", "cpu"]);
const HEIGHT_PROVIDER_KEY_SCALE = 1000;

let activeSaveInvalidationCleanup: (() => void) | null = null;
let activeIntegration: NaadfIntegration | null = null;

export const NAADF_SCENES = new Set([
  "infinite-naadf-flat",
  "infinite-naadf-hills",
  "infinite-naadf-mountains",
  "infinite-naadf-fast-flight",
  "infinite-naadf-fast-turn",
  "infinite-naadf-forest",
  "infinite-naadf-sun-visibility",
  "infinite-naadf-stress-missing",
  "infinite-naadf-far",
]);

export function isNaadfScene(scene: string | null): boolean {
  return scene !== null && NAADF_SCENES.has(scene);
}

export function terrainProfileForScene(scene: string | null): TerrainProfile {
  switch (scene) {
    case "infinite-naadf-flat": return "flat";
    case "infinite-naadf-hills": return "hills";
    case "infinite-naadf-mountains": return "mountains";
    case "infinite-naadf-forest": return "forest";
    default: return "default";
  }
}

export interface NaadfIntegrationOptions {
  yamlText: string;
  sceneName: string | null;
  threeScene?: THREE.Scene;
  forceEnable?: boolean;
}

export interface NaadfIntegration {
  readonly config: NaadfPocConfig;
  readonly state: NaadfWorldState;
  readonly metrics: NaadfMetricsCollector;
  readonly debugOverlay: NaadfDebugOverlay | null;
  update(frameIndex: number, deltaSeconds: number, camera: THREE.PerspectiveCamera): void;
  getHeightProvider(): FarHeightProvider;
  getCanopySampler(): { sampleCanopyCoverage(x: number, z: number): number };
  getFarSummaryGpuAtlasView(): FarSummaryGpuAtlasView | undefined;
  queryHeight(x: number, z: number, purpose?: "render" | "shadow" | "canopy"): ReturnType<typeof queryTerrainHeight>;
  traceSun(x: number, y: number, z: number, sunDir: THREE.Vector3, maxDist: number): ReturnType<typeof traceSunVisibility>;
  getMetricsSnapshot(): ReturnType<NaadfMetricsCollector["snapshot"]>;
  getAcceptanceStatus(): { checks: ReturnType<typeof runAcceptanceChecks>; passed: boolean };
  dispose(): void;
}

export function initNaadfIntegration(options: NaadfIntegrationOptions): NaadfIntegration | null {
  const config = applyRuntimeTraversalOverrides(parseNaadfPocConfig(options.yamlText));
  const active = config.enabled && (options.forceEnable || isNaadfScene(options.sceneName));
  if (!active) {
    disposeActiveIntegrationInstance();
    return null;
  }

  disposeActiveIntegrationInstance();

  const profile = terrainProfileForScene(options.sceneName);
  const source = createTerrainSource(profile, config.world.seed);
  const metrics = new NaadfMetricsCollector();
  const forceMissing = options.sceneName === "infinite-naadf-stress-missing";
  const state = createNaadfWorldState(config, source, metrics, forceMissing);
  const materialCacheConfig = applyRuntimeMaterialCacheOverrides(parseTerrainMaterialCacheConfig(terrainMaterialCacheYaml));
  const materialCache = materialCacheConfig.enabled ? new TerrainMaterialCache(materialCacheConfig) : null;
  const gpuAtlas = config.farShell.heightSamplingMode === "gpu"
    ? new FarSummaryGpuAtlas({
        tileCells: config.farClipmap.tileCells,
        ringCount: config.farClipmap.rings.length,
        tilesX: config.farShell.gpuAtlasWindowTiles,
        tilesZ: config.farShell.gpuAtlasWindowTiles,
        format: config.farSummaryAtlas.format,
        uploadOptions: {
          dirtyRectUploads: config.farSummaryAtlas.dirtyRectUploads,
          fullUploadThresholdPct: config.farSummaryAtlas.fullUploadThresholdPct,
          maxDirtyRectsPerTexture: config.farSummaryAtlas.maxDirtyRectsPerTexture,
        },
        materialCache: materialCache ?? undefined,
        materialCacheConfig,
      })
    : undefined;
  const debugOverlay = options.threeScene
    ? new NaadfDebugOverlay(options.threeScene, config)
    : null;
  const browserWindow = currentWindow();
  const saveInvalidationCleanup = registerNaadfSaveInvalidationTarget(state);
  replaceActiveSaveInvalidationTarget(saveInvalidationCleanup);

  let prevX: number | null = null;
  let prevZ: number | null = null;
  let lastMaterialCacheContentRevision = materialCache?.contentRevision() ?? 0;
  const onMaterialCacheDebug = (event: Event): void => {
    const detail = (event as CustomEvent).detail as Partial<{
      enabled: boolean;
      forceRebake: boolean;
      debugChannel: typeof materialCacheConfig.debug.showFormatChannels;
      showTiles: boolean;
      showInvalidations: boolean;
    }> | undefined;
    if (!detail) return;
    if (detail.enabled !== undefined) materialCacheConfig.enabled = detail.enabled;
    if (detail.forceRebake !== undefined) materialCacheConfig.debug.forceRebake = detail.forceRebake;
    if (detail.debugChannel !== undefined) materialCacheConfig.debug.showFormatChannels = detail.debugChannel;
    if (detail.showTiles !== undefined) materialCacheConfig.debug.showCacheTiles = detail.showTiles;
    if (detail.showInvalidations !== undefined) materialCacheConfig.debug.showInvalidations = detail.showInvalidations;
  };
  browserWindow?.addEventListener("terrain-material-cache-debug", onMaterialCacheDebug);

  const integration: NaadfIntegration = {
    config,
    state,
    metrics,
    debugOverlay,

    update(_frameIndex, deltaSeconds, camera) {
      metrics.beginFrame();
      const vx = prevX !== null && deltaSeconds > 0
        ? (camera.position.x - prevX) / deltaSeconds
        : 0;
      const vz = prevZ !== null && deltaSeconds > 0
        ? (camera.position.z - prevZ) / deltaSeconds
        : 0;
      prevX = camera.position.x;
      prevZ = camera.position.z;

      const scriptedVx = options.sceneName === "infinite-naadf-fast-flight" ? 120 : vx;
      const scriptedVz = options.sceneName === "infinite-naadf-fast-turn" ? 80 : vz;

      updateSummaryStreaming({
        state,
        cameraX: config.debug.freezeStreamCenter && state.frame > 0
          ? state.cameraX
          : camera.position.x,
        cameraZ: config.debug.freezeStreamCenter && state.frame > 0
          ? state.cameraZ
          : camera.position.z,
        velocityX: scriptedVx,
        velocityZ: scriptedVz,
        deltaSeconds,
      });
      if (materialCache && materialCacheConfig.debug.forceRebake) {
        materialCache.invalidateWhere(() => true, "force_rebake");
        materialCacheConfig.debug.forceRebake = false;
      }
      materialCache?.processFrame(state.frame);
      const materialCacheContentRevision = materialCache?.contentRevision() ?? 0;
      if (gpuAtlas && materialCacheContentRevision !== lastMaterialCacheContentRevision) {
        invalidateFarSummaryAtlasSignature(gpuAtlas);
        lastMaterialCacheContentRevision = materialCacheContentRevision;
      }
      gpuAtlas?.updateFromState(state);
      debugOverlay?.update(state);

      const clod = (browserWindow as unknown as { __drusnielClod?: { stats?: { counters?: Record<string, number> } } } | null)?.__drusnielClod;
      if (clod?.stats) {
        const counters = metrics.toCounters();
        if (gpuAtlas?.view) {
          const uploadStats = gpuAtlas.view.uploadStats;
          counters["naadf.farSummaryAtlas.estimatedBytes"] = gpuAtlas.view.estimatedBytes ?? 0;
          counters["naadf.farSummaryAtlas.memorySavingsBytes"] = gpuAtlas.view.memorySavingsBytes ?? 0;
          counters["naadf.farSummaryAtlas.memorySavingsPct"] = gpuAtlas.view.memorySavingsPct ?? 0;
          counters["naadf.farSummaryAtlas.upload.totalPixels"] = uploadStats.totalPixels;
          counters["naadf.farSummaryAtlas.upload.dirtyPixels"] = uploadStats.dirtyPixels;
          counters["naadf.farSummaryAtlas.upload.dirtyPct"] = uploadStats.dirtyPct;
          counters["naadf.farSummaryAtlas.upload.dirtyRects"] = uploadStats.dirtyRects;
          counters["naadf.farSummaryAtlas.upload.dirtyUploads"] = uploadStats.dirtyUploads;
          counters["naadf.farSummaryAtlas.upload.fullUploads"] = uploadStats.fullUploads;
          counters["naadf.farSummaryAtlas.upload.modeCode"] = farSummaryAtlasUploadModeCode(uploadStats.lastUploadMode);
          counters["naadf.farSummaryAtlas.upload.fallbackReasonCode"] = farSummaryAtlasUploadFallbackReasonCode(uploadStats.fallbackReason);
        }
        if (materialCache) Object.assign(counters, terrainMaterialCacheCountersForHud(materialCache));
        if (clod.stats.counters) {
          Object.assign(clod.stats.counters, counters);
        }
      }
    },

    getHeightProvider(): FarHeightProvider {
      let lastKey = "";
      let last = queryTerrainHeight({ state, worldX: 0, worldZ: 0, purpose: "render" });
      const sample = (x: number, z: number) => {
        const key = heightProviderKey(x, z);
        if (key === lastKey) return last;
        lastKey = key;
        last = queryTerrainHeight({ state, worldX: x, worldZ: z, purpose: "render" });
        if (last.missingSample || last.unknown) metrics.farShellMissingSamples++;
        return last;
      };
      return {
        sampleHeight: (x, z) => {
          const r = sample(x, z);
          return Number.isFinite(r.height) ? r.height : 0;
        },
        sampleNormal: (x, z) => {
          const r = sample(x, z);
          return new THREE.Vector3(r.normalX, r.normalY, r.normalZ);
        },
        sampleMaterial: (x, z) => {
          const r = sample(x, z);
          return r.material;
        },
        revision: () => state.frame + ((gpuAtlas?.view.revision ?? 0) * 1_000_000),
      };
    },

    getCanopySampler() {
      return {
        sampleCanopyCoverage: (x: number, z: number) => {
          const r = queryTerrainHeight({ state, worldX: x, worldZ: z, purpose: "canopy" });
          return r.canopyCoverage;
        },
      };
    },

    getFarSummaryGpuAtlasView() {
      return gpuAtlas?.view;
    },

    queryHeight(x, z, purpose = "render") {
      return queryTerrainHeight({ state, worldX: x, worldZ: z, purpose });
    },

    traceSun(x, y, z, sunDir, maxDist) {
      return traceSunVisibility({ state, worldX: x, y, worldZ: z, sunDir, maxDist });
    },

    getMetricsSnapshot() {
      return metrics.snapshot();
    },

    getAcceptanceStatus() {
      const checks = runAcceptanceChecks(state, metrics.snapshot(), config.acceptance);
      return { checks, passed: allAcceptancePassed(checks) };
    },

    dispose() {
      browserWindow?.removeEventListener("terrain-material-cache-debug", onMaterialCacheDebug);
      debugOverlay?.dispose();
      setNaadfIntegration(null);
      if (activeIntegration === integration) activeIntegration = null;
      activeSaveInvalidationCleanup?.();
      activeSaveInvalidationCleanup = null;
    },
  };

  activeIntegration = integration;
  setNaadfIntegration(integration);
  if (browserWindow) {
    browserWindow.__drusnielNaadf = integration;
  }
  return integration;
}

export function getActiveNaadfIntegration(): NaadfIntegration | null {
  return activeIntegration;
}

function disposeActiveIntegrationInstance(): void {
  activeIntegration?.dispose();
  activeIntegration = null;
}

function replaceActiveSaveInvalidationTarget(cleanup: () => void): void {
  activeSaveInvalidationCleanup?.();
  activeSaveInvalidationCleanup = cleanup;
}

function currentWindow(): (Window & { __drusnielNaadf?: NaadfIntegration }) | null {
  return typeof window === "undefined"
    ? null
    : window as Window & { __drusnielNaadf?: NaadfIntegration };
}

function heightProviderKey(x: number, z: number): string {
  return `${Math.round(x * HEIGHT_PROVIDER_KEY_SCALE)}:${Math.round(z * HEIGHT_PROVIDER_KEY_SCALE)}`;
}

function invalidateFarSummaryAtlasSignature(atlas: FarSummaryGpuAtlas): void {
  (atlas as unknown as { lastSignature: string }).lastSignature = "";
}

function applyRuntimeTraversalOverrides(config: NaadfPocConfig): NaadfPocConfig {
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const traversal = params.get("naadfTraversal");
  if (traversal && TRAVERSAL_MODES.has(traversal as NaadfTraversalMode)) {
    config.traversal.mode = traversal as NaadfTraversalMode;
  }
  const heightMode = params.get("naadfFarShellHeightMode");
  if (heightMode && HEIGHT_MODES.has(heightMode as NaadfFarShellHeightSamplingMode)) {
    config.farShell.heightSamplingMode = heightMode as NaadfFarShellHeightSamplingMode;
  }
  const atlasFormat = params.get("naadfFarSummaryAtlasFormat");
  if (atlasFormat && isValidFarSummaryAtlasFormat(atlasFormat)) {
    config.farSummaryAtlas.format = atlasFormat;
  }
  const tiles = Number(params.get("naadfGpuAtlasWindowTiles"));
  if (isValidNaadfGpuAtlasWindowTiles(tiles)) {
    config.farShell.gpuAtlasWindowTiles = Math.floor(tiles);
  }
}
