import type * as THREE from "three";

export interface RainWeatherSettings {
  enabled: boolean;
  intensity: number;
  windX: number;
  windZ: number;
}

export interface SnowWeatherSettings {
  enabled: boolean;
  intensity: number;
  windX: number;
  windZ: number;
}

export interface SandstormWeatherSettings {
  enabled: boolean;
  intensity: number;
  windX: number;
  windZ: number;
}

export interface RainWaterSample {
  waterY: number;
  terrainY: number;
  depth: number;
  bodyMask: number;
}

export interface RainWeatherSamplers {
  surfaceHeight(x: number, z: number): number;
  surfaceNormal(x: number, z: number): [number, number, number];
  waterSample(x: number, z: number): RainWaterSample;
}

export interface RainWeatherStats {
  hardSplashes: number;
  waterSplashes: number;
}

export interface SnowWeatherStats {
  flakes: number;
}

export interface StormWeatherSettings {
  enabled: boolean;
  intensity: number;
}

export interface StormWeatherStats {
  active: boolean;
}

export interface StormWeatherOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  isWebGpu: boolean;
}

export interface SandstormWeatherStats {
  particles: number;
  haze: boolean;
}

export interface RainWeatherOptions {
  scene: THREE.Scene;
  isWebGpu: boolean;
  samplers: RainWeatherSamplers;
  worldCells: number;
  seed?: number;
}

export interface SnowWeatherOptions {
  scene: THREE.Scene;
  isWebGpu: boolean;
  seed?: number;
}

export interface SandstormWeatherOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  isWebGpu: boolean;
  seed?: number;
}

export interface SplashBuffers {
  center: Float32Array;
  normal: Float32Array;
  params: Float32Array;
}
