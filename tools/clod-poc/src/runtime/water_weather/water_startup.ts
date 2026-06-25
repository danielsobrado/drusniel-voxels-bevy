import type { ClodPageNode } from "../../types.js";
import * as THREE from "three";
import type { BorderCoastOceanConfig } from "../../terrain/border_coast_config.js";
import { createDeepOceanSurface, type DeepOceanSurface } from "../../water/deep_ocean_surface.js";
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

  const waterMaterialFactory = isWebGpu
    ? (await import("../../water/waterNodeMaterial.js")).createWaterNodeMaterialImpl
    : (await import("../../water/waterMaterial.js")).createWaterShaderMaterial;
  const deepOceanMaterial = waterMaterialFactory({
    visual: waterConfig.visual,
    debugMode: 0,
    sunDirection: currentLighting().sunDirection.clone(),
    cameraPosition: camera.position.clone(),
    worldBounds: { cellsX: worldCells, cellsZ: worldCells },
  }).material;
  const deepOceanSurface = createDeepOceanSurface(
    worldCells,
    borderCoastOceanConfig.deepOcean,
    deepOceanMaterial,
  );
  if (deepOceanSurface) scene.add(deepOceanSurface.mesh);

  return {
    waterController,
    waterField: waterController.field,
    waterDebugState: waterController.debugState,
    makeWaterVisual: () => waterController.makeVisual(),
    deepOceanSurface,
  };
}
