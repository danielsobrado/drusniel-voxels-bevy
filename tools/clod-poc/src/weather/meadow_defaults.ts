import type { MeadowWeatherSettings } from "./meadow_types.js";

export const MEADOW_CELL_SIZE = 12;
export const MEADOW_RING_RADIUS = 42;
export const MEADOW_BOUNDS_RADIUS = 56;
export const MEADOW_PARTICLE_COUNT = 1200;
export const MEADOW_NEAR_COUNT = 550;
export const MEADOW_MID_COUNT = 400;
export const MEADOW_FAR_COUNT = 250;

export const DEFAULT_MEADOW_WEATHER_SETTINGS: MeadowWeatherSettings = {
  enabled: true,
  intensity: 0.7,
  windX: -0.42,
  windZ: 0.18,
};
