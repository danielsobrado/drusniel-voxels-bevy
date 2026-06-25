import * as THREE from "three";
import type { ClodPageNode } from "../../types.js";
import { formatTreeTotalDisplay, type TreeStats } from "../../trees/index.js";
import type { EnvironmentLighting } from "../../environment.js";
import type { HydrologySystem } from "../../water/index.js";
import { createTreeController } from "./tree_controller.js";
import type { ClodAppState } from "../../app/clod_app_state.js";
import { treeUiState } from "../../app/clod_app_state.js";
import type { VegetationGpuBackend } from "./vegetation_gpu_backend.js";
import type { VegetationStatControllerRefs } from "./vegetation_types.js";
import { formatTreeGpuSummary } from "./vegetation_stats_presenter.js";

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
}

export interface TreeStartupResult {
  treeController: ReturnType<typeof createTreeController>;
  treeSystem: ReturnType<typeof createTreeController>["system"];
  fallingTrees: ReturnType<typeof createTreeController>["fallingTrees"];
  treeStats: { current: TreeStats | null };
  formatTreeGpuSummary: (stats: TreeStats) => string;
}

export function runTreeStartup(input: TreeStartupInput): TreeStartupResult {
  const {
    scene, state, lod0Nodes, worldCells, treeConfig,
    isWebGpu, hydrologySystem, rendererWebGpuDevice, gpuBackend,
    currentLighting, statControllers,
  } = input;

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

  return {
    treeController, treeSystem, fallingTrees, treeStats, formatTreeGpuSummary,
  };
}
