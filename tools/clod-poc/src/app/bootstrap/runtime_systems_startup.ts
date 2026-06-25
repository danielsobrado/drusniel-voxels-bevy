import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ClodPageNode } from "../../types.js";
import { parseGrassConfig } from "../../grass.js";
import { parseStoneConfig } from "../../stones/stone_config.js";
import { parseTreeConfig } from "../../trees/index.js";
import { parseUnderstoryConfig } from "../../understory/index.js";
import {
  type ForestLightingStats,
  parseForestLightingConfig,
} from "../../forest_lighting/index.js";
import type { WaterConfig } from "../../water/waterConfig.js";
import type { HydrologySystem } from "../../water/index.js";
import type { EnvironmentLighting } from "../../environment.js";
import { createForestLightingController } from "../../systems/forest_lighting_controller.js";
import { drainVegetationDirty, type VegetationDirtyQueue } from "../../systems/vegetation_dirty.js";
import type { ClodAppState } from "../clod_app_state.js";
import { forestLightingUiState } from "../clod_app_state.js";
import type { ClodRuntimeBindings } from "../clod_runtime_bindings.js";
import type { AppRenderer } from "./renderer_startup.js";
import type { createTerrainMaterialController } from "../../terrain_runtime/terrain_material_controller.js";
import type { AppSky } from "../../scene/app_sky.js";
import { runWaterWeatherStartup, type WaterWeatherStartupResult } from "./water_weather_startup.js";
import {
  runVegetationStartup,
  type GuiDisplayController,
  type VegetationStartupResult,
  type VegetationStatControllerRefs as VegetationOnlyStatControllerRefs,
} from "./vegetation_startup.js";

export type { GuiDisplayController };

export interface VegetationStatControllerRefs extends VegetationOnlyStatControllerRefs {
  forestLightingStats: GuiDisplayController | null;
}

export interface RuntimeSystemsStartupInput {
  app: AppRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  state: ClodAppState;
  bindings: ClodRuntimeBindings;
  lod0Nodes: ClodPageNode[];
  worldCells: number;
  grassConfig: ReturnType<typeof parseGrassConfig>;
  stoneConfig: ReturnType<typeof parseStoneConfig>;
  treeConfig: ReturnType<typeof parseTreeConfig>;
  understoryConfig: ReturnType<typeof parseUnderstoryConfig>;
  forestLightingConfig: ReturnType<typeof parseForestLightingConfig>;
  waterConfig: WaterConfig;
  queryGrassRingGrid: number | null;
  queryGrassRingCell: number | null;
  isWebGpu: boolean;
  rendererWebGpuDevice: GPUDevice | null;
  hydrologySystem: HydrologySystem | null;
  searchParams: URLSearchParams;
  materialController: ReturnType<typeof createTerrainMaterialController>;
  skyEnvironment: AppSky;
  currentLighting: () => EnvironmentLighting;
  vegetationDirtyQueue: VegetationDirtyQueue;
  statControllers: VegetationStatControllerRefs;
}

export interface RuntimeSystemsStartupResult extends VegetationStartupResult, WaterWeatherStartupResult {
  forestLightingController: ReturnType<typeof createForestLightingController>;
  forestLightingSystem: ReturnType<typeof createForestLightingController>["system"];
  forestLightingStats: { current: ForestLightingStats | null };
  applyForestLightingToPropMaterials: () => void;
  updateLighting: () => void;
  drainVegetationDirtyQueue: () => void;
}

export async function runRuntimeSystemsStartup(
  input: RuntimeSystemsStartupInput,
): Promise<RuntimeSystemsStartupResult> {
  const {
    app,
    scene,
    camera,
    controls,
    state,
    bindings,
    lod0Nodes,
    worldCells,
    grassConfig,
    stoneConfig,
    treeConfig,
    understoryConfig,
    forestLightingConfig,
    waterConfig,
    queryGrassRingGrid,
    queryGrassRingCell,
    isWebGpu,
    rendererWebGpuDevice,
    hydrologySystem,
    searchParams,
    materialController,
    skyEnvironment,
    currentLighting,
    vegetationDirtyQueue,
    statControllers,
  } = input;

  const vegetation = runVegetationStartup({
    app,
    scene,
    controls,
    state,
    lod0Nodes,
    worldCells,
    grassConfig,
    stoneConfig,
    treeConfig,
    understoryConfig,
    queryGrassRingGrid,
    queryGrassRingCell,
    isWebGpu,
    rendererWebGpuDevice,
    hydrologySystem,
    currentLighting,
    statControllers,
  });

  const {
    grassController,
    grassSystem,
    stoneController,
    treeController,
    understoryController,
    treeSystem,
    understorySystem,
  } = vegetation;

  const forestLightingStats = { current: null as ForestLightingStats | null };
  const forestLightingController = createForestLightingController({
    worldCells,
    forestLightingConfig,
    getUiState: () => forestLightingUiState(state),
    getTreeSystem: () => treeSystem,
    getUnderstorySystem: () => understorySystem,
    syncStatsToState: (stats, statsText) => {
      forestLightingStats.current = stats;
      state.forestLightingStats = statsText;
      statControllers.forestLightingStats?.updateDisplay();
    },
  });
  const forestLightingSystem = forestLightingController.system;
  const applyForestLightingToPropMaterials = () => forestLightingController.applyToPropMaterials();
  forestLightingStats.current = forestLightingSystem.getStats();

  const waterWeather = await runWaterWeatherStartup({
    scene,
    camera,
    state,
    waterConfig,
    worldCells,
    hydrologySystem,
    searchParams,
    currentLighting,
    lod0Nodes,
    isWebGpu,
  });

  const { waterController } = waterWeather;

  const updateLighting = () => {
    skyEnvironment?.updateSettings({
      sunAzimuthDeg: state.sunAzimuthDeg,
      sunElevationDeg: state.sunElevationDeg,
      sunIntensity: state.sunIntensity,
      skyIntensity: state.skyIntensity,
      groundIntensity: state.groundIntensity,
      exposure: state.exposure,
      horizonSoftness: state.horizonSoftness,
      sunDiskIntensity: state.sunDiskIntensity,
      sunGlowIntensity: state.sunGlowIntensity,
      hazeIntensity: state.hazeIntensity,
    });
    const lighting = currentLighting();
    materialController.forEachMaterial((mat) => materialController.applyLighting(mat, lighting));
    grassController.updateLighting({
      light: lighting.sunDirection,
      sunColor: lighting.sunColor,
      skyLight: lighting.skyLight,
      groundLight: lighting.groundLight,
    });
    const stoneLighting = {
      light: lighting.sunDirection,
      sunColor: lighting.sunColor,
      skyLight: lighting.skyLight,
      groundLight: lighting.groundLight,
    };
    stoneController.updateLighting(stoneLighting);
    treeController.updateLighting(lighting);
    understoryController.updateLighting(lighting);
    waterController.updateSunDirection(lighting.sunDirection);
  };

  const drainVegetationDirtyQueue = (): void => {
    drainVegetationDirty({
      queue: vegetationDirtyQueue,
      grassEnabled: state.grassEnabled,
      treesEnabled: state.treesEnabled,
      understoryEnabled: state.understoryEnabled,
      markGrassDirty: () => {
        grassSystem.markPatchesDirty();
        bindings.refreshGrassStats();
      },
      markTreesDirty: () => {
        treeController.markPatchesDirty();
        bindings.refreshTreeStats();
      },
      markUnderstoryDirty: () => {
        understoryController.markPatchesDirty();
        bindings.refreshUnderstoryStats();
      },
    });
  };

  return {
    ...vegetation,
    ...waterWeather,
    forestLightingController,
    forestLightingSystem,
    forestLightingStats,
    applyForestLightingToPropMaterials,
    updateLighting,
    drainVegetationDirtyQueue,
  };
}
