import type * as THREE from "three";
import type { RainWeatherSamplers } from "./rain.js";

export interface StormLightningOptions {
  scene: THREE.Scene;
  isWebGpu: boolean;
  samplers: RainWeatherSamplers;
  worldCells: number;
  seed?: number;
}

export interface StrikeBuffers {
  center: Float32Array;
  normal: Float32Array;
  params: Float32Array;
}
