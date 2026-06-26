import * as THREE from "three";
import type { FarHeightProvider } from "../far-summary/clipmap-sampler.js";
import type { NaadfPocConfig } from "./config.js";
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
  queryHeight(x: number, z: number, purpose?: "render" | "shadow" | "canopy"): ReturnType<typeof queryTerrainHeight>;
  traceSun(x: number, y: number, z: number, sunDir: THREE.Vector3, maxDist: number): ReturnType<typeof traceSunVisibility>;
  getMetricsSnapshot(): ReturnType<NaadfMetricsCollector["snapshot"]>;
  getAcceptanceStatus(): { checks: ReturnType<typeof runAcceptanceChecks>; passed: boolean };
  dispose(): void;
}

export function initNaadfIntegration(options: NaadfIntegrationOptions): NaadfIntegration | null {
  const config = parseNaadfPocConfig(options.yamlText);
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
      return {
        sampleHeight: (x, z) => {
          const r = queryTerrainHeight({ state, worldX: x, worldZ: z, purpose: "render" });
          if (r.missingSample || r.unknown) metrics.farShellMissingSamples++;
          return Number.isFinite(r.height) ? r.height : 0;
        },
        sampleNormal: (x, z) => {
          const r = queryTerrainHeight({ state, worldX: x, worldZ: z, purpose: "render" });
          return new THREE.Vector3(r.normalX, r.normalY, r.normalZ);
        },
        sampleMaterial: (x, z) => {
          const r = queryTerrainHeight({ state, worldX: x, worldZ: z, purpose: "render" });
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
