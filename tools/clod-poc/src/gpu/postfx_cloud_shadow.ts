import * as THREE from "three";

export interface PostFxCloudShadowTexture {
  texture: THREE.DataTexture;
  worldSizeMeters: number;
  strength: number;
}

export interface PostFxCloudShadowOptions {
  resolution?: number;
  worldSizeMeters: number;
  seed?: number;
  strength?: number;
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function hash2(x: number, y: number, seed: number): number {
  return fract(Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  const ab = a + (b - a) * fx;
  const cd = c + (d - c) * fx;
  return ab + (cd - ab) * fy;
}

export function cloudShadowValue(u: number, v: number, seed = 17): number {
  let sum = 0;
  let amp = 0.58;
  let freq = 2.1;
  let norm = 0;
  for (let octave = 0; octave < 4; octave++) {
    sum += valueNoise(u * freq + 13.7 * octave, v * freq - 9.1 * octave, seed + octave * 31) * amp;
    norm += amp;
    freq *= 2.15;
    amp *= 0.5;
  }
  const cover = Math.max(0, Math.min(1, (sum / Math.max(1e-6, norm) - 0.42) / 0.34));
  const softened = cover * cover * (3 - 2 * cover);
  return Math.max(0, Math.min(1, 1 - softened * 0.72));
}

export function createPostFxCloudShadowTexture(options: PostFxCloudShadowOptions): PostFxCloudShadowTexture {
  const resolution = Math.max(16, Math.min(1024, Math.round(options.resolution ?? 256)));
  const data = new Float32Array(resolution * resolution);
  const seed = options.seed ?? 17;
  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      data[y * resolution + x] = cloudShadowValue((x + 0.5) / resolution, (y + 0.5) / resolution, seed);
    }
  }
  const texture = new THREE.DataTexture(data, resolution, resolution, THREE.RedFormat, THREE.FloatType);
  texture.name = "postfx-cloud-shadow";
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return {
    texture,
    worldSizeMeters: Math.max(1, options.worldSizeMeters),
    strength: Math.max(0, Math.min(1, options.strength ?? 0.55)),
  };
}
