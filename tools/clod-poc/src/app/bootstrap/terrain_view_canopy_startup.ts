import type * as THREE from "three";
import type { TerrainSummaryField } from "../../clod/terrain_summary.js";
import type { ClodHooks } from "../../core/hooks.js";
import type { EnvironmentLighting } from "../../environment/environment.js";
import {
  shouldUseDeterministicCanopy,
  type CanopyShellConfig,
} from "../../canopy/canopy_config.js";
import {
  createCanopyShellSystem,
  type CanopyShellSystem,
} from "../../canopy/canopy_system.js";
import {
  applyConfigToCanopyDebugState,
  createCanopyDebugState,
  type CanopyDebugState,
} from "../../canopy/canopy_debug.js";
import type { VegetationLodConfig } from "../../vegetation/vegetation_lod_config.js";
import type { TerrainFieldConfig } from "../../terrain/terrain.js";

export interface TerrainViewCanopyResolveInput {
  canopyConfig: CanopyShellConfig;
  queryScene: string | null;
  queryCanopy: boolean;
}

export interface TerrainViewCanopyResolved {
  useDeterministicCanopy: boolean;
  getCanopyConfig: () => CanopyShellConfig;
  setCanopyConfig: (config: CanopyShellConfig) => void;
  getCanopyDebugState: () => CanopyDebugState | null;
  setCanopyDebugState: (state: CanopyDebugState | null) => void;
}

export function resolveTerrainViewCanopyStartup(
  input: TerrainViewCanopyResolveInput,
): TerrainViewCanopyResolved {
  let liveCanopyConfig = structuredClone(input.canopyConfig);
  const useDeterministicCanopy = shouldUseDeterministicCanopy(
    input.queryScene,
    liveCanopyConfig,
    input.queryCanopy,
  );
  let canopyDebugState: CanopyDebugState | null = useDeterministicCanopy
    ? createCanopyDebugState(liveCanopyConfig)
    : null;

  return {
    useDeterministicCanopy,
    getCanopyConfig: () => liveCanopyConfig,
    setCanopyConfig: (config: CanopyShellConfig) => {
      liveCanopyConfig = structuredClone(config);
      if (canopyDebugState) {
        applyConfigToCanopyDebugState(canopyDebugState, liveCanopyConfig);
      }
    },
    getCanopyDebugState: () => canopyDebugState,
    setCanopyDebugState: (state: CanopyDebugState | null) => {
      canopyDebugState = state;
    },
  };
}

export interface TerrainViewCanopyShellInput {
  searchParams: URLSearchParams;
  queryScene: string | null;
  queryCanopy: boolean;
  useDeterministicCanopy: boolean;
  scene: THREE.Scene;
  terrainSummary: TerrainSummaryField;
  worldSizeCells: number;
  terrainFieldConfig: TerrainFieldConfig | null;
  getLighting: () => EnvironmentLighting;
  getCanopyConfig: () => CanopyShellConfig;
  vegetationLodConfig: VegetationLodConfig;
  getCanopyDebugState: () => CanopyDebugState | null;
  setCanopyDebugState: (state: CanopyDebugState | null) => void;
  longViewHooks: ClodHooks | null;
}

export interface TerrainViewCanopyShellResult {
  canopyShellSystem: CanopyShellSystem | null;
  canopyDebugState: CanopyDebugState | null;
}

export function createTerrainViewCanopyShell(
  input: TerrainViewCanopyShellInput,
): TerrainViewCanopyShellResult {
  const {
    searchParams,
    queryScene,
    queryCanopy,
    useDeterministicCanopy,
    scene,
    terrainSummary,
    worldSizeCells,
    terrainFieldConfig,
    getLighting,
    getCanopyConfig,
    vegetationLodConfig,
    getCanopyDebugState,
    setCanopyDebugState,
    longViewHooks,
  } = input;

  const canopyShellSystem = useDeterministicCanopy
    ? createCanopyShellSystem(searchParams, queryScene, queryCanopy, {
      scene,
      terrainSummary,
      worldSizeCells,
      terrainFieldConfig,
      getLighting,
      getConfig: () => getCanopyConfig(),
      getVegetationLodConfig: () => vegetationLodConfig,
      getDebugState: () => getCanopyDebugState()!,
      onCounters: (counters) => {
        if (!longViewHooks?.stats) return;
        for (const [key, value] of Object.entries(counters)) {
          longViewHooks.stats.counters[key] = value;
        }
      },
    })
    : null;
  if (canopyShellSystem) {
    setCanopyDebugState(canopyShellSystem.debugState);
  }

  return {
    canopyShellSystem,
    canopyDebugState: getCanopyDebugState(),
  };
}
