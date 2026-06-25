import * as THREE from "three";
import type { WeatherMode } from "../clod_constants.js";
import type { ProjectWeatherArchiveState } from "../../project/project_archive.js";
import { assignArchiveFields } from "./archive_fields.js";

export interface WeatherSliceState {
  weatherMode: WeatherMode;
  weatherIntensity: number;
  weatherWindX: number;
  weatherWindZ: number;
  weatherStats: string;
}

const WEATHER_ARCHIVE_KEYS = [
  "weatherMode", "weatherIntensity", "weatherWindX", "weatherWindZ",
] as const satisfies readonly (keyof ProjectWeatherArchiveState)[];

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

export function applyWeatherArchiveState(
  target: WeatherSliceState,
  archive: ProjectWeatherArchiveState,
): void {
  assignArchiveFields(target, archive, WEATHER_ARCHIVE_KEYS);
}
