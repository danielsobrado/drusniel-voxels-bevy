import * as THREE from "three";
import type { ClodPageNode } from "../../types.js";
import type { EnvironmentLighting } from "../../environment/environment.js";
import type { BorderCoastOceanConfig } from "../../terrain/border_coast_config.js";
import type { WaterConfig } from "../../water/waterConfig.js";
import type { HydrologySystem } from "../../water/index.js";
import type { ClodAppState } from "../../app/clod_app_state.js";
import { runWaterStartup, type WaterStartupResult } from "./water_startup.js";
import { runWeatherStartup, type WeatherStartupResult } from "./weather_startup.js";

export interface WaterWeatherStartupInput {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  state: ClodAppState;
  waterConfig: WaterConfig;
  borderCoastOceanConfig: BorderCoastOceanConfig;
  worldCells: number;
  hydrologySystem: HydrologySystem | null;
  searchParams: URLSearchParams;
  currentLighting: () => EnvironmentLighting;
  lod0Nodes: ClodPageNode[];
  isWebGpu: boolean;
}

export interface WaterWeatherStartupResult extends WaterStartupResult, WeatherStartupResult {}

export async function runWaterWeatherStartup(
  input: WaterWeatherStartupInput,
): Promise<WaterWeatherStartupResult> {
  const water = await runWaterStartup(input);

  const weather = runWeatherStartup({
    scene: input.scene,
    camera: input.camera,
    isWebGpu: input.isWebGpu,
    worldCells: input.worldCells,
    waterField: water.waterField,
    state: input.state,
  });

  return {
    ...water,
    ...weather,
  };
}
