import * as THREE from "three";
import type { ClodPageNode } from "../../types.js";
import { formatTreeTotalDisplay, type TreeStats } from "../../trees/index.js";
import type { EnvironmentLighting } from "../../environment/environment.js";
import type { HydrologySystem } from "../../water/index.js";
import { createTreeController } from "./tree_controller.js";
import type { ClodAppState } from "../../app/clod_app_state.js";
import { treeUiState } from "../../app/clod_app_state.js";
import type { VegetationGpuBackend } from "./vegetation_gpu_backend.js";
import type { VegetationStatControllerRefs } from "./vegetation_types.js";
import { formatTreeGpuSummary } from "./vegetation_stats_presenter.js";
import { packHydrologyData } from "../../systems/hydrology_packing.js";
import { setTreeGpuRingHydrologyData } from "../../gpu/tree_ring_compute.js";
import type { TreeSettings } from "../../trees/tree_config.js";

export interface TreeStartupInput {
  scene: THREE.Scene;
  state: ClodAppState;
  lod0Nodes: ClodPageNode[];
  worldCells: number;
  treeConfig: ReturnType<typeof import("../../trees/index.js").parseTreeConfig>;
  isWebGpu: boolean;
  hydrologySystem: HydrologySystem | null;
  rendererWebGpuDevice: GPUDevice | null;
  gpuBackend: VegetationGpuBackend | null;
  currentLighting: () => EnvironmentLighting;
  statControllers: VegetationStatControllerRefs;
  renderer: unknown;
}

export interface TreeStartupResult {
  treeController: ReturnType<typeof createTreeController>;
  treeSystem: ReturnType<typeof createTreeController>["system"];
  fallingTrees: ReturnType<typeof createTreeController>["fallingTrees"];
  treeStats: { current: TreeStats | null };
  formatTreeGpuSummary: (stats: TreeStats) => string;
}

function sanitizeRuntimeTreeConfig(config: TreeSettings): TreeSettings {
  const ditherEnabled = config.lod.ditherEnabled === true;
  return {
    ...config,
    lod: {
      ...config.lod,
      crossfadeEnabled: config.lod.crossfadeEnabled && ditherEnabled,
      crossfadeBandM: ditherEnabled ? config.lod.crossfadeBandM : 0,
      ditherEnabled,
    },
    foliage: {
      ...config.foliage,
      enabled: false,
      alphaTest: 0,
      debugShowAlphaCards: false,
      oak: { ...config.foliage.oak },
      pine: { ...config.foliage.pine },
    },
    impostors: {
      ...config.impostors,
      enabled: false,
      bakeOnStart: false,
      fallbackToPlaceholder: false,
    },
  };
}

export function runTreeStartup(input: TreeStartupInput): TreeStartupResult {
  const {
    scene, state, lod0Nodes, worldCells,
    isWebGpu, hydrologySystem, rendererWebGpuDevice, gpuBackend,
    currentLighting, statControllers, renderer,
  } = input;
  const treeConfig = sanitizeRuntimeTreeConfig(input.treeConfig);

  setTreeGpuRingHydrologyData(hydrologySystem ? packHydrologyData(hydrologySystem) : null);

  const treeStats = { current: null as TreeStats | null };

  const treeController = createTreeController({
    scene,
    nodes: lod0Nodes,
    worldCells,
    treeConfig,
    webgpu: isWebGpu,
    hydrologyWaterTexture: hydrologySystem ? hydrologySystem.waterSurfaceTexture() : null,
    gpuDevice: rendererWebGpuDevice,
    gpuBackend,
    getUiState: () => treeUiState(state),
    getLighting: currentLighting,
    syncStatsToState: (stats) => {
      treeStats.current = stats;
      state.treeTotal = formatTreeTotalDisplay(stats);
      state.treeVisiblePatches = `${stats.visiblePatches}/${stats.patches}`;
      state.treeLodSummary = `${stats.nearTrees}/${stats.midTrees}/${stats.farTrees}/${stats.impostorTrees}`;
      state.treeGpuSummary = formatTreeGpuSummary(stats);
      statControllers.treeTotal?.updateDisplay();
      statControllers.treeVisiblePatches?.updateDisplay();
      statControllers.treeLodSummary?.updateDisplay();
      statControllers.treeGpuSummary?.updateDisplay();
    },
  });
  const treeSystem = treeController.system;
  const fallingTrees = treeController.fallingTrees;
  treeStats.current = treeSystem.getStats();

  if (treeConfig.impostors.enabled && treeConfig.impostors.bakeOnStart) {
    void treeController.bakeImpostors(renderer).then((result) => {
      if (!result.supported) console.info(`[trees] impostor baking fallback: ${result.reason ?? "unsupported"}`);
      treeController.refreshStats();
    }).catch((error) => {
      console.warn("[trees] impostor baking failed", error);
      treeController.refreshStats();
    });
  }

  return {
    treeController, treeSystem, fallingTrees, treeStats, formatTreeGpuSummary,
  };
}
