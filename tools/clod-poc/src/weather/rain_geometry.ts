import * as THREE from "three";
import { Rng, hashCombine, hashString } from "../core/seed.js";
import {
  DROP_COUNT,
  RAIN_AREA,
  SANDSTORM_FAR_COUNT,
  SANDSTORM_MID_COUNT,
  SANDSTORM_NEAR_COUNT,
  SANDSTORM_PARTICLE_COUNT,
  SNOW_FAR_AREA,
  SNOW_FLAKE_COUNT,
  SNOW_MID_AREA,
  SNOW_NEAR_AREA,
} from "./rain_constants.js";
import type { SplashBuffers } from "./rain_types.js";

export function createRainGeometry(seed: number): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
    -1, 0, 0,
    1, 0, 0,
    -1, 1, 0,
    1, 1, 0,
  ]), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([
    0, 0,
    1, 0,
    0, 1,
    1, 1,
  ]), 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 2, 1, 3]), 1));
  geometry.instanceCount = DROP_COUNT;

  const offset = new Float32Array(DROP_COUNT * 4);
  const shape = new Float32Array(DROP_COUNT * 4);
  const rng = new Rng(hashCombine(seed, hashString("rain-drops")));
  for (let i = 0; i < DROP_COUNT; i++) {
    const o = i * 4;
    offset[o] = rng.range(-RAIN_AREA * 0.5, RAIN_AREA * 0.5);
    offset[o + 1] = rng.float();
    offset[o + 2] = rng.range(-RAIN_AREA * 0.5, RAIN_AREA * 0.5);
    offset[o + 3] = rng.range(13.0, 27.0);
    shape[o] = rng.range(0.7, 1.65);
    shape[o + 1] = rng.range(0.008, 0.022);
    shape[o + 2] = rng.float();
    shape[o + 3] = rng.float();
  }
  geometry.setAttribute("aRainOffset", new THREE.InstancedBufferAttribute(offset, 4));
  geometry.setAttribute("aRainShape", new THREE.InstancedBufferAttribute(shape, 4));
  return geometry;
}

export function createSnowGeometry(seed: number): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
    -1, -1, 0,
    1, -1, 0,
    -1, 1, 0,
    1, 1, 0,
    0, -1, -1,
    0, -1, 1,
    0, 1, -1,
    0, 1, 1,
  ]), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([
    0, 0,
    1, 0,
    0, 1,
    1, 1,
    0, 0,
    1, 0,
    0, 1,
    1, 1,
  ]), 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([
    0, 1, 2, 2, 1, 3,
    4, 5, 6, 6, 5, 7,
  ]), 1));
  geometry.instanceCount = SNOW_FLAKE_COUNT;

  const offset = new Float32Array(SNOW_FLAKE_COUNT * 4);
  const shape = new Float32Array(SNOW_FLAKE_COUNT * 4);
  const rng = new Rng(hashCombine(seed, hashString("snow-flakes")));
  for (let i = 0; i < SNOW_FLAKE_COUNT; i++) {
    const o = i * 4;
    const band = rng.float();
    const area = band < 0.42 ? SNOW_NEAR_AREA : band < 0.74 ? SNOW_MID_AREA : SNOW_FAR_AREA;
    offset[o] = rng.range(-area * 0.5, area * 0.5);
    offset[o + 1] = rng.float();
    offset[o + 2] = rng.range(-area * 0.5, area * 0.5);

    if (band < 0.42) {
      offset[o + 3] = rng.range(1.1, 2.4);
      shape[o] = rng.range(0.11, 0.23);
      shape[o + 1] = rng.range(0.38, 0.82);
      shape[o + 2] = rng.range(0.18, 0.3);
    } else if (band < 0.74) {
      offset[o + 3] = rng.range(1.85, 3.1);
      shape[o] = rng.range(0.065, 0.135);
      shape[o + 1] = rng.range(0.24, 0.5);
      shape[o + 2] = rng.range(0.25, 0.39);
    } else {
      offset[o + 3] = rng.range(2.4, 4.2);
      shape[o] = rng.range(0.035, 0.078);
      shape[o + 1] = rng.range(0.1, 0.3);
      shape[o + 2] = rng.range(0.32, 0.48);
    }
    shape[o + 3] = rng.float();
  }
  geometry.setAttribute("aSnowOffset", new THREE.InstancedBufferAttribute(offset, 4));
  geometry.setAttribute("aSnowShape", new THREE.InstancedBufferAttribute(shape, 4));
  return geometry;
}

export function createSandstormGeometry(seed: number): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
    -1, -1, 0,
    1, -1, 0,
    -1, 1, 0,
    1, 1, 0,
    0, -1, -1,
    0, -1, 1,
    0, 1, -1,
    0, 1, 1,
  ]), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([
    0, 0,
    1, 0,
    0, 1,
    1, 1,
    0, 0,
    1, 0,
    0, 1,
    1, 1,
  ]), 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([
    0, 1, 2, 2, 1, 3,
    4, 5, 6, 6, 5, 7,
  ]), 1));
  geometry.instanceCount = SANDSTORM_PARTICLE_COUNT;

  const offset = new Float32Array(SANDSTORM_PARTICLE_COUNT * 4);
  const shape = new Float32Array(SANDSTORM_PARTICLE_COUNT * 4);
  const rng = new Rng(hashCombine(seed, hashString("sandstorm-puffs")));
  writeSandstormBand({ rng, offset, shape, start: 0, count: SANDSTORM_NEAR_COUNT, area: 28, yMin: -3.0, yMax: 0.85, speedMin: 1.1, speedMax: 3.0, sizeMin: 0.058, sizeMax: 0.21, opacityMin: 0.05, opacityMax: 0.18 });
  writeSandstormBand({ rng, offset, shape, start: SANDSTORM_NEAR_COUNT, count: SANDSTORM_MID_COUNT, area: 48, yMin: -2.7, yMax: 2.8, speedMin: 1.8, speedMax: 4.1, sizeMin: 0.04, sizeMax: 0.145, opacityMin: 0.035, opacityMax: 0.12 });
  writeSandstormBand({ rng, offset, shape, start: SANDSTORM_NEAR_COUNT + SANDSTORM_MID_COUNT, count: SANDSTORM_FAR_COUNT, area: 72, yMin: -2.2, yMax: 5.8, speedMin: 2.5, speedMax: 5.4, sizeMin: 0.024, sizeMax: 0.095, opacityMin: 0.024, opacityMax: 0.082 });
  geometry.setAttribute("aSandOffset", new THREE.InstancedBufferAttribute(offset, 4));
  geometry.setAttribute("aSandShape", new THREE.InstancedBufferAttribute(shape, 4));
  return geometry;
}

interface SandstormBandOptions {
  rng: Rng;
  offset: Float32Array;
  shape: Float32Array;
  start: number;
  count: number;
  area: number;
  yMin: number;
  yMax: number;
  speedMin: number;
  speedMax: number;
  sizeMin: number;
  sizeMax: number;
  opacityMin: number;
  opacityMax: number;
}

function writeSandstormBand(options: SandstormBandOptions): void {
  const { rng, offset, shape } = options;
  for (let i = 0; i < options.count; i++) {
    const o = (options.start + i) * 4;
    offset[o] = rng.range(-options.area * 0.5, options.area * 0.5);
    offset[o + 1] = rng.float();
    offset[o + 2] = rng.range(options.yMin, options.yMax);
    offset[o + 3] = options.area;
    shape[o] = rng.range(options.sizeMin, options.sizeMax);
    shape[o + 1] = rng.range(options.opacityMin, options.opacityMax);
    shape[o + 2] = rng.range(options.speedMin, options.speedMax);
    shape[o + 3] = rng.float() * 1000;
  }
}

export function createSplashGeometry(count: number): { geometry: THREE.InstancedBufferGeometry; buffers: SplashBuffers } {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
    -1, -1, 0,
    1, -1, 0,
    -1, 1, 0,
    1, 1, 0,
  ]), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([
    0, 0,
    1, 0,
    0, 1,
    1, 1,
  ]), 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 2, 1, 3]), 1));
  geometry.instanceCount = count;

  const buffers: SplashBuffers = {
    center: new Float32Array(count * 3),
    normal: new Float32Array(count * 3),
    params: new Float32Array(count * 4),
  };
  for (let i = 0; i < count; i++) {
    buffers.normal[i * 3 + 1] = 1;
  }
  geometry.setAttribute("aSplashCenter", new THREE.InstancedBufferAttribute(buffers.center, 3));
  geometry.setAttribute("aSplashNormal", new THREE.InstancedBufferAttribute(buffers.normal, 3));
  geometry.setAttribute("aSplashParams", new THREE.InstancedBufferAttribute(buffers.params, 4));
  return { geometry, buffers };
}
