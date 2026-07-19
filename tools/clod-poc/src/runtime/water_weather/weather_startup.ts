import * as THREE from "three";
import type { EnvironmentLighting } from "../../environment/environment.js";
import { configureEnvironmentalMaskSettings } from "../../environment_masks/environment_mask_runtime.js";
import { surfaceHeight, surfaceNormal } from "../../terrain/terrain.js";
import { createWeatherController } from "./weather_controller.js";
import type { WaterStartupResult } from "./water_startup.js";
import environmentMaskConfigText from "../../../config/environment_masks.yaml?raw";

export interface WeatherStartupInput {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  isWebGpu: boolean;
  worldCells: number;
  waterField: WaterStartupResult["waterField"];
  state: import("../../app/clod_app_state.js").ClodAppState;
  currentLighting: () => EnvironmentLighting;
}

export interface WeatherStartupResult {
  weatherController: ReturnType<typeof createWeatherController>;
  applyWeatherSettings: () => void;
  updateWeatherStats: () => void;
}

export function runWeatherStartup(input: WeatherStartupInput): WeatherStartupResult {
  const { scene, camera, isWebGpu, worldCells, waterField, state } = input;
  configureEnvironmentalMaskSettings(environmentMaskConfigText);

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
    getLighting: input.currentLighting,
    setStatsText: (text) => { state.weatherStats = text; },
  });

  return {
    weatherController,
    applyWeatherSettings: () => weatherController.applySettings(),
    updateWeatherStats: () => weatherController.refreshStats(),
  };
}
