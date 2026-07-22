import type * as THREE from "three";
import longViewYaml from "../../../config/long_view.yaml?raw";
import type { TerrainSummaryField } from "../../clod/terrain_summary.js";
import type { ClodHooks } from "../../core/hooks.js";
import type { EnvironmentLighting } from "../../environment/environment.js";
import {
  applyShadowProxyDebugQueryOverrides,
  applyShadowProxySceneOverrides,
  createShadowProxyController,
  createShadowProxyDebugState,
  parseLongViewSunShadowsConfig,
  resolveShadowProxyRebuildSnapMeters,
  type ShadowProxyController,
  type ShadowProxyDebugState,
} from "../../shadows/index.js";
import type { ShadowProxyConfig } from "../../shadows/shadowProxyTypes.js";
import type { AppRenderer } from "./renderer_startup.js";

export interface TerrainViewShadowProxyResolveInput {
  isLongView: boolean;
  searchParams: URLSearchParams;
  queryScene: string | null;
}

export interface TerrainViewShadowProxyResolved {
  longViewSunConfig: ReturnType<typeof parseLongViewSunShadowsConfig>;
  shadowProxyDebugState: ShadowProxyDebugState | null;
  getShadowProxyConfig: () => ShadowProxyConfig;
  setShadowProxyConfig: (config: ShadowProxyConfig) => void;
}

export function resolveTerrainViewShadowProxyStartup(
  input: TerrainViewShadowProxyResolveInput,
): TerrainViewShadowProxyResolved {
  const { isLongView, searchParams, queryScene } = input;
  const longViewSunConfig = parseLongViewSunShadowsConfig(longViewYaml);
  const shadowProxyConfig = applyShadowProxySceneOverrides(
    applyShadowProxyDebugQueryOverrides(longViewSunConfig.shadowProxy, searchParams),
    queryScene,
  );
  const shadowProxyDebugState = isLongView
    ? createShadowProxyDebugState(shadowProxyConfig, longViewSunConfig.enabled)
    : null;
  if (shadowProxyDebugState && searchParams.get("shadowProxyDebugLambert") === "1") {
    shadowProxyDebugState.debugLambertFarShellReceiver = true;
  }
  let liveShadowProxyConfig = { ...shadowProxyConfig };
  return {
    longViewSunConfig,
    shadowProxyDebugState,
    getShadowProxyConfig: () => liveShadowProxyConfig,
    setShadowProxyConfig: (config: ShadowProxyConfig) => {
      liveShadowProxyConfig = { ...config };
    },
  };
}

export interface TerrainViewShadowProxyControllerInput {
  isLongView: boolean;
  streamingCentered: boolean;
  scene: THREE.Scene;
  renderer: AppRenderer["renderer"];
  terrainSummary: TerrainSummaryField;
  worldSizeCells: number;
  camera: THREE.PerspectiveCamera;
  longViewHooks: ClodHooks | null;
  longViewSunConfig: ReturnType<typeof parseLongViewSunShadowsConfig>;
  shadowProxyDebugState: ShadowProxyDebugState | null;
  getShadowProxyConfig: () => ShadowProxyConfig;
  getLighting: () => EnvironmentLighting;
}

export interface TerrainViewShadowProxyControllerResult {
  shadowProxyController: ShadowProxyController | null;
}

export function createTerrainViewShadowProxyController(
  input: TerrainViewShadowProxyControllerInput,
): TerrainViewShadowProxyControllerResult {
  const {
    isLongView,
    streamingCentered,
    scene,
    renderer,
    terrainSummary,
    worldSizeCells,
    camera,
    longViewHooks,
    longViewSunConfig,
    shadowProxyDebugState,
    getShadowProxyConfig,
    getLighting,
  } = input;

  const shadowProxyController = isLongView
    ? createShadowProxyController(
      { enabled: longViewSunConfig.enabled, shadowProxy: getShadowProxyConfig() },
      {
        scene,
        renderer,
        getTerrainSummary: () => window.__drusnielTerrainSummary ?? terrainSummary,
        worldSize: worldSizeCells,
        isLongView,
        streamingCentered,
        rebuildSnapMeters: resolveShadowProxyRebuildSnapMeters(getShadowProxyConfig()),
        getSunShadowsEnabled: () => shadowProxyDebugState?.sunShadowsEnabled ?? false,
        getConfig: () => getShadowProxyConfig(),
        getLighting,
        getCoverageCenter: () => ({ x: camera.position.x, z: camera.position.z }),
        onCounters: (counters) => {
          if (!longViewHooks?.stats) return;
          for (const [key, value] of Object.entries(counters)) {
            longViewHooks.stats.counters[key] = value;
          }
        },
      },
    )
    : null;

  if (shadowProxyDebugState && shadowProxyController) {
    shadowProxyDebugState.shadowProxyStatsLine = shadowProxyController.runtime.stats.built
      ? `tris ${shadowProxyController.runtime.stats.triangleCount}`
      : "shadow proxy: not built";
  }

  return { shadowProxyController };
}
