import * as THREE from "three";

export interface NoiseBakePeriods {
  value: number;
  fbm: number;
  ridged: number;
  worley: number;
}

export interface NoiseBakeConfig {
  seed: number;
  resolution: number;
  periods: NoiseBakePeriods;
}

export interface NoiseBakeResult {
  resolution: number;
  periods: NoiseBakePeriods;
  dataA: Uint8Array;
  dataB: Uint8Array;
  noiseA: THREE.DataTexture;
  noiseB: THREE.DataTexture;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function hash22(ix: number, iy: number, seed: number): [number, number] {
  return [hash2(ix, iy, seed), hash2(ix + 19, iy - 37, seed ^ 0x9e3779b9)];
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

export function valueNoise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = smooth(fx);
  const uy = smooth(fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  const x0 = a + (b - a) * ux;
  const x1 = c + (d - c) * ux;
  return x0 + (x1 - x0) * uy;
}

export function fbm2(x: number, y: number, seed: number, octaves = 3): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave++) {
    sum += valueNoise2(x * freq + octave * 17.13, y * freq - octave * 9.71, seed + octave * 1013) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.02;
  }
  return sum / Math.max(norm, 0.0001);
}

export function ridged2(x: number, y: number, seed: number, octaves = 3): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave++) {
    const n = Math.abs(valueNoise2(x * freq + octave * 13.7, y * freq + octave * 5.2, seed ^ 0x6c8e9cf5) * 2 - 1);
    const r = 1 - n;
    sum += r * r * amp;
    norm += amp;
    amp *= 0.53;
    freq *= 2.1;
  }
  return sum / Math.max(norm, 0.0001);
}

export function worleyF1(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  let best = 8;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const [hx, hy] = hash22(ix + ox, iy + oy, seed);
      const dx = ox + hx - fx;
      const dy = oy + hy - fy;
      best = Math.min(best, Math.hypot(dx, dy));
    }
  }
  return clamp01(best / 1.41421356237);
}

function enc01(value: number): number {
  return Math.round(clamp01(value) * 255);
}

function encSigned(value: number, range: number): number {
  return enc01(value / (range * 2) + 0.5);
}

function makeDataTexture(data: Uint8Array, resolution: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, resolution, resolution, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.MirroredRepeatWrapping;
  tex.wrapT = THREE.MirroredRepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export function bakeNoiseTextures(config: NoiseBakeConfig): NoiseBakeResult {
  const resolution = Math.max(2, Math.floor(config.resolution));
  const dataA = new Uint8Array(resolution * resolution * 4);
  const dataB = new Uint8Array(resolution * resolution * 4);
  const eFbm = (config.periods.fbm / resolution) * 0.5;
  const eRid = (config.periods.ridged / resolution) * 0.5;
  const gradRange = 2.0;

  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      const i = (y * resolution + x) * 4;
      const u = (x + 0.5) / resolution;
      const v = (y + 0.5) / resolution;
      const value = valueNoise2(u * config.periods.value, v * config.periods.value, config.seed);
      const fx = u * config.periods.fbm;
      const fy = v * config.periods.fbm;
      const fbm = fbm2(fx, fy, config.seed);
      const fdx = (fbm2(fx + eFbm, fy, config.seed) - fbm2(fx - eFbm, fy, config.seed)) / (2 * eFbm);
      const fdy = (fbm2(fx, fy + eFbm, config.seed) - fbm2(fx, fy - eFbm, config.seed)) / (2 * eFbm);
      const rx = u * config.periods.ridged;
      const ry = v * config.periods.ridged;
      const ridged = ridged2(rx, ry, config.seed);
      const rdx = (ridged2(rx + eRid, ry, config.seed) - ridged2(rx - eRid, ry, config.seed)) / (2 * eRid);
      const rdy = (ridged2(rx, ry + eRid, config.seed) - ridged2(rx, ry - eRid, config.seed)) / (2 * eRid);
      const worley = worleyF1(u * config.periods.worley, v * config.periods.worley, config.seed);

      dataA[i] = enc01(value);
      dataA[i + 1] = enc01(fbm);
      dataA[i + 2] = encSigned(fdx, gradRange);
      dataA[i + 3] = encSigned(fdy, gradRange);
      dataB[i] = encSigned(rdx, gradRange);
      dataB[i + 1] = encSigned(rdy, gradRange);
      dataB[i + 2] = enc01(ridged);
      dataB[i + 3] = enc01(worley);
    }
  }

  return {
    resolution,
    periods: { ...config.periods },
    dataA,
    dataB,
    noiseA: makeDataTexture(dataA, resolution),
    noiseB: makeDataTexture(dataB, resolution),
  };
}

export function sampleNoiseChannel(data: Uint8Array, resolution: number, u: number, v: number, channel: number): number {
  const x = ((Math.floor(u * resolution) % resolution) + resolution) % resolution;
  const y = ((Math.floor(v * resolution) % resolution) + resolution) % resolution;
  return data[(y * resolution + x) * 4 + channel] / 255;
}
