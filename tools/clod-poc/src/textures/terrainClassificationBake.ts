import * as THREE from "three";
import { sampleNoiseChannel, type NoiseBakeResult } from "./noiseBake.js";
import type { ProceduralTextureConfig } from "./materialRecipes.js";

export interface TerrainClassificationBakeConfig {
  config: ProceduralTextureConfig;
  noise: NoiseBakeResult;
  resolution?: number;
}

export interface TerrainClassificationBakeResult {
  resolution: number;
  dataA: Uint8Array;
  classificationA: THREE.DataTexture;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(edge1 - edge0, 0.0001));
  return t * t * (3 - 2 * t);
}

function enc01(value: number): number {
  return Math.round(clamp01(value) * 255);
}

function makeDataTexture(data: Uint8Array, resolution: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data as Uint8Array<ArrayBuffer>, resolution, resolution, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export function bakeTerrainClassificationTexture(
  input: TerrainClassificationBakeConfig,
): TerrainClassificationBakeResult {
  const resolution = Math.max(2, Math.floor(input.resolution ?? input.noise.resolution));
  const dataA = new Uint8Array(resolution * resolution * 4);
  const masks = input.config.terrain.masks;

  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      const u = (x + 0.5) / resolution;
      const v = (y + 0.5) / resolution;
      const macro = sampleNoiseChannel(input.noise.dataA, input.noise.resolution, u, v, 1);
      const ridged = sampleNoiseChannel(input.noise.dataB, input.noise.resolution, u * 2, v * 2, 2);
      const worley = sampleNoiseChannel(input.noise.dataB, input.noise.resolution, u * 2.5, v * 2.5, 3);
      const height = 8 + macro * 92 + ridged * 28;
      const upness = clamp01(1 - ridged * 0.55);
      const slope = clamp01(1 - upness);
      const snow = smoothstep(masks.snow_height[0], masks.snow_height[1], height)
        * smoothstep(masks.snow_upness[0], masks.snow_upness[1], upness);
      const wetness = (1 - smoothstep(masks.wet_height[0], masks.wet_height[1], height))
        * smoothstep(masks.wet_upness[0], masks.wet_upness[1], upness)
        * (0.65 + worley * 0.35);
      const vegetation = smoothstep(10, 42, height)
        * (1 - smoothstep(68, 104, height))
        * smoothstep(0.45, 0.92, upness)
        * (1 - snow);
      const rockExposure = smoothstep(masks.gravel_slope[0], masks.gravel_slope[1], slope)
        * (0.55 + ridged * 0.45)
        * (1 - wetness * 0.35);
      const i = (y * resolution + x) * 4;
      dataA[i] = enc01(snow);
      dataA[i + 1] = enc01(wetness);
      dataA[i + 2] = enc01(vegetation);
      dataA[i + 3] = enc01(rockExposure);
    }
  }

  return {
    resolution,
    dataA,
    classificationA: makeDataTexture(dataA, resolution),
  };
}

export function sampleClassificationChannel(
  data: Uint8Array,
  resolution: number,
  u: number,
  v: number,
  channel: number,
): number {
  const x = ((Math.floor(u * resolution) % resolution) + resolution) % resolution;
  const y = ((Math.floor(v * resolution) % resolution) + resolution) % resolution;
  return data[(y * resolution + x) * 4 + channel] / 255;
}
