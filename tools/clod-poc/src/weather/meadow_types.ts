export interface MeadowWeatherSettings {
  enabled: boolean;
  intensity: number;
  windX: number;
  windZ: number;
}

export interface MeadowWeatherStats {
  particles: number;
}

export interface MeadowWeatherOptions {
  scene: import("three").Scene;
  isWebGpu: boolean;
  seed?: number;
}

export interface MeadowBandOptions {
  rng: import("../core/seed.js").Rng;
  offset: Float32Array;
  shape: Float32Array;
  start: number;
  count: number;
  radius: number;
  yMin: number;
  yMax: number;
  speedMin: number;
  speedMax: number;
  sizeMin: number;
  sizeMax: number;
  opacityMin: number;
  opacityMax: number;
}
