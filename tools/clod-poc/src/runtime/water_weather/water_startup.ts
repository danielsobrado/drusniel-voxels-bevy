import type { ClodPageNode } from "../../types.js";
import * as THREE from "three";
import type { BorderCoastOceanConfig } from "../../terrain/border_coast_config.js";
import { createDeepOceanSurface, type DeepOceanSurface } from "../../water/deep_ocean_surface.js";
import { createDeepOceanMaterial, type DeepOceanMaterialHandle } from "../../water/deep_ocean_material.js";
import { configureDeepOceanWaves } from "../../water/deep_ocean_waves.js";
import { resolveDeepOceanVisual } from "../../water/deep_ocean_visual.js";
import { createDeepOceanSampler, type OceanSampler } from "../../water/ocean_service.js";
import type { WaterConfig } from "../../water/waterConfig.js";
import type { HydrologySystem } from "../../water/index.js";
import { surfaceHeight } from "../../terrain/terrain.js";
import { createWaterController } from "./water_controller.js";
import type { ClodAppState } from "../../app/clod_app_state.js";
import { waterUiState } from "../../app/clod_app_state.js";

export interface WaterStartupInput {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  state: ClodAppState;
  waterConfig: WaterConfig;
  borderCoastOceanConfig: BorderCoastOceanConfig;
  worldCells: number;
  hydrologySystem: HydrologySystem | null;
  searchParams: URLSearchParams;
  currentLighting: () => import("../../environment/environment.js").EnvironmentLighting;
  lod0Nodes: ClodPageNode[];
  isWebGpu: boolean;
}

export interface WaterStartupResult {
  waterController: Awaited<ReturnType<typeof createWaterController>>;
  waterField: Awaited<ReturnType<typeof createWaterController>>["field"];
  waterDebugState: Awaited<ReturnType<typeof createWaterController>>["debugState"];
  makeWaterVisual: () => ReturnType<Awaited<ReturnType<typeof createWaterController>>["makeVisual"]>;
  deepOceanSurface: DeepOceanSurface | null;
  deepOceanMaterial: DeepOceanMaterialHandle | null;
  deepOceanConfig: BorderCoastOceanConfig["deepOcean"];
  oceanSampler: OceanSampler | null;
}

export async function runWaterStartup(input: WaterStartupInput): Promise<WaterStartupResult> {
  const {
    scene, camera, state, waterConfig, borderCoastOceanConfig, worldCells,
    hydrologySystem, searchParams, currentLighting, lod0Nodes, isWebGpu,
  } = input;

  const waterController = await createWaterController({
    scene,
    nodes: lod0Nodes,
    waterConfig,
    worldCells,
    isWebGpu,
    surfaceHeight,
    hydrologySystem,
    camera,
    getSunDirection: () => currentLighting().sunDirection,
    getUiState: () => waterUiState(state),
    searchParams,
    devMode: import.meta.env.DEV,
    borderCoastOceanConfig,
  });

  const deepOceanConfig = borderCoastOceanConfig.deepOcean;
  const oceanSampler = deepOceanConfig.enabled
    ? createDeepOceanSampler(worldCells, deepOceanConfig)
    : null;
  if (oceanSampler) configureDeepOceanWaves(deepOceanConfig.wave);

  const lighting = currentLighting();
  const deepOceanMaterial = oceanSampler
    ? await createDeepOceanMaterial(isWebGpu, {
        visual: resolveDeepOceanVisual(waterConfig.visual, deepOceanConfig),
        wave: deepOceanConfig.wave,
        shading: deepOceanConfig.shading,
        surfaceY: deepOceanConfig.surfaceY,
        fogDistanceM: deepOceanConfig.shading.fogFarM,
        sunDirection: lighting.sunDirection.clone(),
        cameraPosition: camera.position.clone(),
        horizonColor: lighting.skyLight,
      })
    : null;
  const deepOceanSurface = deepOceanMaterial
    ? createDeepOceanSurface(
        worldCells,
        deepOceanConfig,
        deepOceanMaterial.material,
      )
    : null;
  if (deepOceanSurface) scene.add(deepOceanSurface.mesh);

  return {
    waterController,
    waterField: waterController.field,
    waterDebugState: waterController.debugState,
    makeWaterVisual: () => waterController.makeVisual(),
    deepOceanSurface,
    deepOceanMaterial,
    deepOceanConfig,
    oceanSampler,
  };
}
