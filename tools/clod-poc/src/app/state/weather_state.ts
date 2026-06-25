import * as THREE from "three";
import type { WeatherMode } from "../clod_constants.js";

export interface WeatherSliceState {
  weatherMode: WeatherMode;
  weatherIntensity: number;
  weatherWindX: number;
  weatherWindZ: number;
  weatherStats: string;
}

export function createWeatherSliceState(input: {
  queryWeatherMode: WeatherMode;
  queryWeatherIntensity: number;
  queryWeatherWindX: number;
  queryWeatherWindZ: number;
  weatherDefaults: { intensity: number; windX: number; windZ: number };
}): WeatherSliceState {
  return {
    weatherMode: input.queryWeatherMode,
    weatherIntensity: Number.isFinite(input.queryWeatherIntensity)
      ? THREE.MathUtils.clamp(input.queryWeatherIntensity, 0, 1.6)
      : input.weatherDefaults.intensity,
    weatherWindX: Number.isFinite(input.queryWeatherWindX) ? input.queryWeatherWindX : input.weatherDefaults.windX,
    weatherWindZ: Number.isFinite(input.queryWeatherWindZ) ? input.queryWeatherWindZ : input.weatherDefaults.windZ,
    weatherStats: "off",
  };
}
