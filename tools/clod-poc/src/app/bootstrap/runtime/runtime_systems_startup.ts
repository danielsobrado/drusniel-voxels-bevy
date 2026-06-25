import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ClodPageNode } from "../../../types.js";
import { parseGrassConfig } from "../../../grass.js";
import { parseStoneConfig } from "../../../stones/stone_config.js";
import { parseTreeConfig } from "../../../trees/index.js";
import { parseUnderstoryConfig } from "../../../understory/index.js";
import type { WaterConfig } from "../../../water/waterConfig.js";
import type { HydrologySystem } from "../../../water/index.js";
import type { EnvironmentLighting } from "../../../environment.js";
import { drainVegetationDirty, type VegetationDirtyQueue } from "../../../systems/vegetation_dirty.js";
import type { ClodHooks } from "../../../core/hooks.js";
import type { ClodRuntimeBindings } from "../../clod_runtime_bindings.js";
import type { AppRenderer } from "../renderer_startup.js";
import type { createTerrainMaterialController } from "../../../terrain/material/terrain_material_controller.js";
import type { AppSky } from "../../../scene/app_sky.js";
import { runWaterWeatherStartup, type WaterWeatherStartupResult } from "../../../runtime/water_weather/water_weather_startup.js";
import {
  runVegetationStartup,
  type VegetationStartupResult,
} from "../../../runtime/vegetation/vegetation_startup.js";
import type {
  VegetationStatControllerRefs,
} from "../../../runtime/vegetation/vegetation_types.js";
import {
  runForestLightingStartup,
  type ForestLightingStartupResult,
} from "./forest_lighting_startup.js";
import {
  runCustomPropsStartup,
  resolveCustomPropsEnabled,
  type CustomPropsStartupResult,
} from "../custom_props_startup.js";
import { resolvePropPlacementScene } from "../../../props/prop_placements.js";
import type { CustomPropsSettings, PropPlacementScene } from "../../../props/prop_types.js";

export type { VegetationStatControllerRefs } from "../../../runtime/vegetation/vegetation_types.js";

export interface RuntimeSystemsStartupInput {
  app: AppRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  state: import("../../clod_app_state.js").ClodAppState;
  bindings: ClodRuntimeBindings;
  lod0Nodes: ClodPageNode[];
  worldCells: number;
  grassConfig: ReturnType<typeof parseGrassConfig>;
  stoneConfig: ReturnType<typeof parseStoneConfig>;
  treeConfig: ReturnType<typeof parseTreeConfig>;
  understoryConfig: ReturnType<typeof parseUnderstoryConfig>;
  forestLightingConfig: ReturnType<typeof import("../../../forest_lighting/index.js").parseForestLightingConfig>;
  waterConfig: WaterConfig;
  customPropsConfig: CustomPropsSettings;
  propPlacementScenes: Record<string, PropPlacementScene>;
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
  getHooks: () => ClodHooks | null;
}

export interface RuntimeSystemsStartupResult extends VegetationStartupResult, WaterWeatherStartupResult,
  ForestLightingStartupResult {
  updateLighting: () => void;
  drainVegetationDirtyQueue: () => void;
  customProps: CustomPropsStartupResult | null;
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
    customPropsConfig,
    propPlacementScenes,
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
    getHooks,
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

  const forestLighting = runForestLightingStartup({
    worldCells,
    forestLightingConfig,
    state,
    treeSystem,
    understorySystem,
    statControllers,
  });

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

  const customPropsEnabled = resolveCustomPropsEnabled(searchParams, customPropsConfig);
  let customProps: CustomPropsStartupResult | null = null;
  if (customPropsEnabled) {
    try {
      const placementScene = resolvePropPlacementScene(
        searchParams,
        propPlacementScenes,
        propPlacementScenes.smoke!,
      );
      customProps = await runCustomPropsStartup({
        scene,
        camera,
        customPropsConfig,
        placementScene,
        enabled: true,
        searchParams,
        getHooks,
      });
    } catch (error) {
      console.error("[custom-props] failed to initialize", error);
    }
  }

  return {
    ...vegetation,
    ...waterWeather,
    ...forestLighting,
    updateLighting,
    drainVegetationDirtyQueue,
    customProps,
  };
}
