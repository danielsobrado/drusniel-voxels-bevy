import type { ProjectWaterArchiveState, ProjectWeatherArchiveState } from "./voxel_project_archive_types.js";
import { DEFAULT_WATER_VISUAL } from "../water/waterConfig.js";
import { DEFAULT_RAIN_WEATHER_SETTINGS } from "../weather/rain.js";

export const DEFAULT_PROJECT_WATER_ARCHIVE_STATE: ProjectWaterArchiveState = {
  waterEnabled: true,
  waterDebugMode: "final",
  waterClipmapTint: false,
  waterWireframe: false,
  waterDepthWrite: DEFAULT_WATER_VISUAL.depthWrite,
};

export const DEFAULT_PROJECT_WEATHER_ARCHIVE_STATE: ProjectWeatherArchiveState = {
  weatherMode: "off",
  weatherIntensity: DEFAULT_RAIN_WEATHER_SETTINGS.intensity,
  weatherWindX: DEFAULT_RAIN_WEATHER_SETTINGS.windX,
  weatherWindZ: DEFAULT_RAIN_WEATHER_SETTINGS.windZ,
};
