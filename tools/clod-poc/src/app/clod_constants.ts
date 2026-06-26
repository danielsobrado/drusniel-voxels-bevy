export const LOD_COLORS = [0x9ca3ad, 0x3a6ea5, 0x49a078, 0xd98032];

export const WEATHER_MODE_OPTIONS = ["off", "meadow", "rain", "snow", "sandstorm", "storm"] as const;
export type WeatherMode = typeof WEATHER_MODE_OPTIONS[number];

export const PAINT_SWATCH_COLORS = ["#6b9b4d", "#8c8580", "#d9c78d", "#f5f7ff"];

export const TERRAIN_BAND_ICONS = ["grass", "earth", "rock", "snow"] as const;

export const FAR_SHELL_DEFAULTS = {
  enabled: true,
  radiusFactor: 2.5,
  heightBias: 0.1,
  heightDrop: 4.5,
  radiusFactorMin: 1.0,
  radiusFactorMax: 5.0,
} as const;
