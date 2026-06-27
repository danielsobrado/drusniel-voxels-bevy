import * as THREE from "three";
import type { FarHeightProvider } from "../far-summary/clipmap-sampler.js";
import type { NaadfFarShellHeightSamplingMode, NaadfPocConfig, NaadfTraversalMode } from "./config.js";
import { parseNaadfPocConfig } from "./config.js";
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

const TRAVERSAL_MODES: ReadonlySet<NaadfTraversalMode> = new Set(["dense", "hdda", "compare"]);
const HEIGHT_MODES: ReadonlySet<NaadfFarShellHeightSamplingMode> = new Set(["gpu", "cpu"]);
const HEIGHT_PROVIDER_KEY_SCALE = 1000;

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
    setNaadfIntegration(undefined);
    return null;
  }

  const profile = terrainProfileForScene(options.sceneName);
  const source = createTerrainSource(profile, config.world.seed);
  const metrics = new NaadfMetricsCollector();
  const forceMissing = options.sceneName === "infinite-naadf-stress-missing";
  const state = createNaadfWorldState(config, source, metrics, forceMissing);
  const gpuAtlas = config.farShell.heightSamplingMode === "gpu"
    ? new FarSummaryGpuAtlas({
        tileCells: config.farClipmap.tileCells,
        ringCount: config.farClipmap.rings.length,
      })
    : undefined;
  const debugOverlay = options.threeScene
    ? new NaadfDebugOverlay(options.threeScene, config)
    : null;

  let prevX: number | null = null;
  let prevZ: number | null = null;

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
      gpuAtlas?.updateFromState(state);
      debugOverlay?.update(state);

      const clod = (window as unknown as { __drusnielClod?: { stats?: { counters?: Record<string, number> } } }).__drusnielClod;
      if (clod?.stats) {
        const counters = metrics.toCounters();
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
      return traceSunVisibility({
        state,
        worldX: x,
        worldY: y,
        worldZ: z,
        sunDirX: sunDir.x,
        sunDirY: sunDir.y,
        sunDirZ: sunDir.z,
        maxDistanceM: maxDist,
      });
    },

    getMetricsSnapshot() {
      return metrics.snapshot();
    },

    getAcceptanceStatus() {
      const checks = runAcceptanceChecks(config, metrics.snapshot(), 120);
      return { checks, passed: allAcceptancePassed(checks) };
    },

    dispose() {
      debugOverlay?.dispose();
      gpuAtlas?.dispose();
      state.residents.length = 0;
      state.residentIndexByKey.clear();
      state.farTiles.clear();
      state.farTileLastTouched.clear();
      state.pendingJobs.clear();
    },
  };

  setNaadfIntegration(integration);
  return integration;
}

function heightProviderKey(x: number, z: number): string {
  const qx = Math.round(x * HEIGHT_PROVIDER_KEY_SCALE);
  const qz = Math.round(z * HEIGHT_PROVIDER_KEY_SCALE);
  return `${qx}:${qz}`;
}

function applyRuntimeTraversalOverrides(config: NaadfPocConfig): NaadfPocConfig {
  const params = currentSearchParams();
  if (!params) return config;

  const mode = params.get("naadfTraversal") ?? params.get("traversal");
  if (mode && TRAVERSAL_MODES.has(mode as NaadfTraversalMode)) {
    config.traversal.mode = mode as NaadfTraversalMode;
  }

  const bounds = params.get("naadfHddaBounds");
  if (bounds === "1" || bounds === "true") config.traversal.hddaUseDirectionalBounds = true;
  if (bounds === "0" || bounds === "false") config.traversal.hddaUseDirectionalBounds = false;

  const heightMode = params.get("naadfHeightMode") ?? params.get("naadfFarShellHeightMode");
  if (heightMode && HEIGHT_MODES.has(heightMode as NaadfFarShellHeightSamplingMode)) {
    config.farShell.heightSamplingMode = heightMode as NaadfFarShellHeightSamplingMode;
  }

  const shellGrid = positiveIntParam(params.get("naadfShellGrid"));
  if (shellGrid !== null) config.farShell.gridRes = shellGrid;

  return config;
}

function positiveIntParam(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function currentSearchParams(): URLSearchParams | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search);
}

declare global {
  interface Window {
    __drusnielNaadf?: NaadfIntegration;
  }
}

export {
  parseNaadfPocConfig,
  queryTerrainHeight,
  tracePrimaryDebugRay,
  traceSunVisibility,
  NaadfMetricsCollector,
  createNaadfWorldState,
  updateSummaryStreaming,
};
