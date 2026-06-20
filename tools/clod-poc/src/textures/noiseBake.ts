import * as THREE from "three";
import {
  periodCells,
  periodicFbm2,
  periodicRidged2,
  periodicValueNoise2,
  periodicWorleyF1,
} from "./periodicNoise.js";
import { deriveSeedStreams } from "./seedStreams.js";

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

function enc01(value: number): number {
  return Math.round(clamp01(value) * 255);
}

function encSigned(value: number, range: number): number {
  return enc01(value / (range * 2) + 0.5);
}

function makeDataTexture(data: Uint8Array, resolution: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, resolution, resolution, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
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
  const valuePeriod = periodCells(config.periods.value);
  const fbmPeriod = periodCells(config.periods.fbm);
  const ridgedPeriod = periodCells(config.periods.ridged);
  const worleyPeriod = periodCells(config.periods.worley);
  const streams = deriveSeedStreams(config.seed);
  const gradRange = 2.0;

  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      const i = (y * resolution + x) * 4;
      const u = (x + 0.5) / resolution;
      const v = (y + 0.5) / resolution;
      const value = periodicValueNoise2(u * config.periods.value, v * config.periods.value, valuePeriod, streams.noise_value);
      const fx = u * config.periods.fbm;
      const fy = v * config.periods.fbm;
      const fbm = periodicFbm2(fx, fy, fbmPeriod, streams.noise_fbm);
      const fdx = (periodicFbm2(fx + eFbm, fy, fbmPeriod, streams.noise_fbm) - periodicFbm2(fx - eFbm, fy, fbmPeriod, streams.noise_fbm)) / (2 * eFbm);
      const fdy = (periodicFbm2(fx, fy + eFbm, fbmPeriod, streams.noise_fbm) - periodicFbm2(fx, fy - eFbm, fbmPeriod, streams.noise_fbm)) / (2 * eFbm);
      const rx = u * config.periods.ridged;
      const ry = v * config.periods.ridged;
      const ridged = periodicRidged2(rx, ry, ridgedPeriod, streams.noise_ridged);
      const rdx = (periodicRidged2(rx + eRid, ry, ridgedPeriod, streams.noise_ridged) - periodicRidged2(rx - eRid, ry, ridgedPeriod, streams.noise_ridged)) / (2 * eRid);
      const rdy = (periodicRidged2(rx, ry + eRid, ridgedPeriod, streams.noise_ridged) - periodicRidged2(rx, ry - eRid, ridgedPeriod, streams.noise_ridged)) / (2 * eRid);
      const worley = periodicWorleyF1(u * config.periods.worley, v * config.periods.worley, worleyPeriod, streams.noise_worley);

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
