import type {
  RainWeatherSettings,
  SandstormWeatherSettings,
  SnowWeatherSettings,
  StormWeatherSettings,
} from "./rain_types.js";

export const DEFAULT_RAIN_WEATHER_SETTINGS: RainWeatherSettings = {
  enabled: false,
  intensity: 0.9,
  windX: -1.05,
  windZ: 0.28,
};

export const DEFAULT_SNOW_WEATHER_SETTINGS: SnowWeatherSettings = {
  enabled: false,
  intensity: 1,
  windX: -0.62,
  windZ: 0.21,
};

export const DEFAULT_SANDSTORM_WEATHER_SETTINGS: SandstormWeatherSettings = {
  enabled: false,
  intensity: 1,
  windX: -1.8,
  windZ: 0.24,
};

export const DEFAULT_STORM_WEATHER_SETTINGS: StormWeatherSettings = {
  enabled: false,
  intensity: 1,
};
