import * as THREE from "three";

export const WATER_FOAM_NOISE_SIZE = 128;
const WATER_FOAM_BASE_CELLS = 4;
const WATER_FOAM_OCTAVES = 4;
const WATER_FOAM_SEED_A = 0x5f3759df;
const WATER_FOAM_SEED_B = 0x9e3779b9;

let sharedTexture: THREE.DataTexture | null = null;

export function getWaterFoamNoiseTexture(): THREE.DataTexture {
  if (sharedTexture) return sharedTexture;

  const texture = new THREE.DataTexture(
    buildWaterFoamNoiseData(),
    WATER_FOAM_NOISE_SIZE,
    WATER_FOAM_NOISE_SIZE,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = "water-foam-noise";
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  sharedTexture = texture;
  return texture;
}

export function buildWaterFoamNoiseData(size = WATER_FOAM_NOISE_SIZE): Uint8Array {
  if (!Number.isInteger(size) || size < 8) {
    throw new Error(`water foam noise size must be an integer >= 8, got ${size}`);
  }

  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const a = periodicFbm(u, v, WATER_FOAM_SEED_A);
      const b = periodicFbm(v + 0.317, 1 - u + 0.193, WATER_FOAM_SEED_B);
      const offset = (y * size + x) * 4;
      data[offset] = toByte(a);
      data[offset + 1] = toByte(b);
      data[offset + 2] = toByte(a * 0.55 + b * 0.45);
      data[offset + 3] = 255;
    }
  }
  return data;
}

function periodicFbm(u: number, v: number, seed: number): number {
  let amplitude = 0.5;
  let sum = 0;
  let norm = 0;

  for (let octave = 0; octave < WATER_FOAM_OCTAVES; octave += 1) {
    const period = WATER_FOAM_BASE_CELLS << octave;
    sum += periodicValueNoise(u * period, v * period, period, seed + octave * 0x6d2b79f5) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
  }

  return sum / norm;
}

function periodicValueNoise(x: number, y: number, period: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth01(x - x0);
  const ty = smooth01(y - y0);
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  const n00 = latticeNoise(wrap(x0, period), wrap(y0, period), seed);
  const n10 = latticeNoise(wrap(x1, period), wrap(y0, period), seed);
  const n01 = latticeNoise(wrap(x0, period), wrap(y1, period), seed);
  const n11 = latticeNoise(wrap(x1, period), wrap(y1, period), seed);
  return lerp(lerp(n00, n10, tx), lerp(n01, n11, tx), ty);
}

function latticeNoise(x: number, y: number, seed: number): number {
  let value = Math.imul(x ^ seed, 0x27d4eb2d) ^ Math.imul(y + seed, 0x165667b1);
  value ^= value >>> 15;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}

function wrap(value: number, period: number): number {
  const result = value % period;
  return result < 0 ? result + period : result;
}

function smooth01(value: number): number {
  return value * value * (3 - 2 * value);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function toByte(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}
