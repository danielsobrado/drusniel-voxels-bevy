import * as THREE from "three";
import type { ClodPageNode } from "../../types.js";
import type { EnvironmentLighting } from "../../environment.js";
import type { WaterConfig } from "../../water/waterConfig.js";
import type { HydrologySystem } from "../../water/index.js";
import { surfaceHeight, surfaceNormal } from "../../terrain.js";
import { createWaterController } from "../../systems/water_controller.js";
import { createWeatherController } from "../../systems/weather_controller.js";
import type { ClodAppState } from "../clod_app_state.js";
import { waterUiState } from "../clod_app_state.js";

export interface WaterWeatherStartupInput {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  state: ClodAppState;
  waterConfig: WaterConfig;
  worldCells: number;
  hydrologySystem: HydrologySystem | null;
  searchParams: URLSearchParams;
  currentLighting: () => EnvironmentLighting;
  lod0Nodes: ClodPageNode[];
  isWebGpu: boolean;
}

export interface WaterWeatherStartupResult {
  waterController: Awaited<ReturnType<typeof createWaterController>>;
  waterField: Awaited<ReturnType<typeof createWaterController>>["field"];
  waterDebugState: Awaited<ReturnType<typeof createWaterController>>["debugState"];
  makeWaterVisual: () => ReturnType<Awaited<ReturnType<typeof createWaterController>>["makeVisual"]>;
  weatherController: ReturnType<typeof createWeatherController>;
  applyWeatherSettings: () => void;
  updateWeatherStats: () => void;
}

export async function runWaterWeatherStartup(
  input: WaterWeatherStartupInput,
): Promise<WaterWeatherStartupResult> {
  const {
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
  });
  const waterField = waterController.field;
  const waterDebugState = waterController.debugState;
  const makeWaterVisual = () => waterController.makeVisual();

  const weatherController = createWeatherController({
    scene,
    camera,
    isWebGpu,
    worldCells,
    surfaceHeight,
    surfaceNormal,
    waterSample: (x, z) => waterField.sample(x, z),
    getSettings: () => ({
      weatherMode: state.weatherMode,
      weatherIntensity: state.weatherIntensity,
      weatherWindX: state.weatherWindX,
      weatherWindZ: state.weatherWindZ,
    }),
    setStatsText: (text) => { state.weatherStats = text; },
  });
  const applyWeatherSettings = () => weatherController.applySettings();
  const updateWeatherStats = () => weatherController.refreshStats();

  return {
    waterController,
    waterField,
    waterDebugState,
    makeWaterVisual,
    weatherController,
    applyWeatherSettings,
    updateWeatherStats,
  };
}
