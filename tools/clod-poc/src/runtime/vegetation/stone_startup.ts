import * as THREE from "three";
import type { ClodPageNode } from "../../types.js";
import type { StoneStats } from "../../stones/stone_instances.js";
import type { EnvironmentLighting } from "../../environment/environment.js";
import type { HydrologySystem } from "../../water/index.js";
import { createStoneController } from "./stone_controller.js";
import type { ClodAppState } from "../../app/clod_app_state.js";
import { stoneUiState } from "../../app/clod_app_state.js";
import type { VegetationGpuBackend } from "./vegetation_gpu_backend.js";
import { packHydrologyData } from "../../systems/hydrology_packing.js";
import type { VegetationStatControllerRefs } from "./vegetation_types.js";

export interface StoneStartupInput {
  scene: THREE.Scene;
  state: ClodAppState;
  lod0Nodes: ClodPageNode[];
  worldCells: number;
  stoneConfig: ReturnType<typeof import("../../stones/stone_config.js").parseStoneConfig>;
  hydrologySystem: HydrologySystem | null;
  rendererWebGpuDevice: GPUDevice | null;
  gpuBackend: VegetationGpuBackend | null;
  currentLighting: () => EnvironmentLighting;
  statControllers: VegetationStatControllerRefs;
}

export interface StoneStartupResult {
  stoneController: ReturnType<typeof createStoneController>;
  stoneSystem: ReturnType<typeof createStoneController>["system"];
  stoneStats: { current: StoneStats | null };
  visibleStoneClasses: ReturnType<typeof createStoneController>["visibleClasses"];
  onStoneScatterComplete: { current: (() => void) | null };
}

export function runStoneStartup(input: StoneStartupInput): StoneStartupResult {
  const {
    scene, state, lod0Nodes, worldCells, stoneConfig,
    hydrologySystem, rendererWebGpuDevice, gpuBackend,
    currentLighting, statControllers,
  } = input;

  const currentGrassLighting = (): import("../../grass.js").GrassLighting => {
    const lighting = currentLighting();
    return {
      light: lighting.sunDirection,
      sunColor: lighting.sunColor,
      skyLight: lighting.skyLight,
      groundLight: lighting.groundLight,
    };
  };

  const stoneStats = { current: null as StoneStats | null };
  const onStoneScatterComplete = { current: null as (() => void) | null };

  const stoneHydrologyData = hydrologySystem ? packHydrologyData(hydrologySystem) : null;

  const stoneController = createStoneController({
    scene,
    nodes: lod0Nodes,
    worldCells,
    stoneConfig,
    hydrologyWaterTexture: hydrologySystem ? hydrologySystem.waterSurfaceTexture() : null,
    hydrologyGpuData: stoneHydrologyData,
    gpuDevice: rendererWebGpuDevice,
    gpuBackend,
    getUiState: () => stoneUiState(state),
    getLighting: currentGrassLighting,
    onScatterStats: () => onStoneScatterComplete.current?.(),
    syncStatsToState: (stats) => {
      stoneStats.current = stats;
      state.stoneTotal = stats.total;
      state.stoneClassSummary = `${stats.large}/${stats.medium}/${stats.small}`;
      state.stoneVisible = stats.visible;
      statControllers.stoneTotal?.updateDisplay();
      statControllers.stoneClassSummary?.updateDisplay();
      statControllers.stoneVisible?.updateDisplay();
    },
  });
  const stoneSystem = stoneController.system;
  const visibleStoneClasses = () => stoneController.visibleClasses();
  stoneStats.current = stoneSystem.getStats();

  return {
    stoneController, stoneSystem, stoneStats, visibleStoneClasses, onStoneScatterComplete,
  };
}
