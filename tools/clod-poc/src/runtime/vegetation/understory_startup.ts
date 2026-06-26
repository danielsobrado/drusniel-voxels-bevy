import * as THREE from "three";
import type { ClodPageNode } from "../../types.js";
import {
  type UnderstoryStats,
} from "../../understory/index.js";
import type { EnvironmentLighting } from "../../environment/environment.js";
import type { HydrologySystem } from "../../water/index.js";
import { createUnderstoryController } from "./understory_controller.js";
import { packHydrologyData } from "../../systems/hydrology_packing.js";
import type { ClodAppState } from "../../app/clod_app_state.js";
import { understoryUiState } from "../../app/clod_app_state.js";
import type { VegetationGpuBackend } from "./vegetation_gpu_backend.js";
import type { VegetationStatControllerRefs } from "./vegetation_types.js";
import { formatUnderstoryGpuSummary } from "./vegetation_stats_presenter.js";

export interface UnderstoryStartupInput {
  scene: THREE.Scene;
  state: ClodAppState;
  lod0Nodes: ClodPageNode[];
  worldCells: number;
  understoryConfig: ReturnType<typeof import("../../understory/index.js").parseUnderstoryConfig>;
  isWebGpu: boolean;
  hydrologySystem: HydrologySystem | null;
  rendererWebGpuDevice: GPUDevice | null;
  gpuBackend: VegetationGpuBackend | null;
  currentLighting: () => EnvironmentLighting;
  statControllers: VegetationStatControllerRefs;
}

export interface UnderstoryStartupResult {
  understoryController: ReturnType<typeof createUnderstoryController>;
  understorySystem: ReturnType<typeof createUnderstoryController>["system"];
  understoryStats: { current: UnderstoryStats | null };
  formatUnderstoryGpuSummary: (stats: UnderstoryStats) => string;
}

export function runUnderstoryStartup(input: UnderstoryStartupInput): UnderstoryStartupResult {
  const {
    scene, state, lod0Nodes, worldCells, understoryConfig,
    isWebGpu, hydrologySystem, rendererWebGpuDevice, gpuBackend,
    currentLighting, statControllers,
  } = input;

  const understoryStats = { current: null as UnderstoryStats | null };

  const understoryController = createUnderstoryController({
    scene,
    nodes: lod0Nodes,
    worldCells,
    understoryConfig,
    webgpu: isWebGpu,
    hydrologyData: hydrologySystem ? packHydrologyData(hydrologySystem) : null,
    hydrologyWaterTexture: hydrologySystem ? hydrologySystem.waterSurfaceTexture() : null,
    gpuDevice: rendererWebGpuDevice,
    gpuBackend,
    getUiState: () => understoryUiState(state),
    getLighting: currentLighting,
    syncStatsToState: (stats) => {
      understoryStats.current = stats;
      state.understoryTotal = stats.totalInstances;
      state.understoryVisiblePatches = `${stats.visiblePatches}/${stats.patches}`;
      state.understoryClassSummary =
        `${stats.shrub}/${stats.fern}/${stats.sapling}/${stats.flower}/${stats.deadLog}/${stats.stump}`;
      state.understoryGpuSummary = formatUnderstoryGpuSummary(stats);
      statControllers.understoryTotal?.updateDisplay();
      statControllers.understoryVisiblePatches?.updateDisplay();
      statControllers.understoryClassSummary?.updateDisplay();
      statControllers.understoryGpuSummary?.updateDisplay();
    },
  });
  const understorySystem = understoryController.system;
  understoryStats.current = understorySystem.getStats();

  return {
    understoryController, understorySystem, understoryStats, formatUnderstoryGpuSummary,
  };
}
