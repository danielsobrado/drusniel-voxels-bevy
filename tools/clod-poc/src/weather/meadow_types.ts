import type * as THREE from "three";
import type { RainWeatherShaderHandle } from "./rain_shader_handle.js";
import type { SunbeamMoteRuntimeSettings } from "./sunbeam_mote_runtime.js";

export interface MeadowWeatherSettings {
  enabled: boolean;
  intensity: number;
  windX: number;
  windZ: number;
  motes: SunbeamMoteRuntimeSettings;
}

export interface MeadowWeatherEnvironment {
  cameraPosition: THREE.Vector3;
  sunDirection: THREE.Vector3;
  amount: number;
  coldBlend: number;
  localMist: number;
}

export interface MeadowWeatherStats {
  particles: number;
  atlasValid: boolean;
  visualAmount: number;
}

export interface MeadowWeatherOptions {
  scene: THREE.Scene;
  isWebGpu: boolean;
  seed?: number;
}

export interface MeadowWeatherMaterialHandle extends RainWeatherShaderHandle {
  setMoteSettings(settings: SunbeamMoteRuntimeSettings): void;
  setEnvironment(environment: MeadowWeatherEnvironment): void;
  setSunVisibilityAtlas(originX: number, originZ: number, worldSize: number, valid: number): void;
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
