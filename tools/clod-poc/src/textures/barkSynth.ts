import * as THREE from "three";
import {
  periodicValueNoise2,
  periodicWorleyF1Edge,
} from "./periodicNoise.js";

export const BARK_RES = 2048;

export interface BarkParams {
  plates: [number, number];
  warp: number;
  fissureW: number;
  fissureDepth: number;
  plateRound: number;
  micro: number;
  vertCrack: number;
  lenticels: number;
  deep: [number, number, number];
  high: [number, number, number];
  mottle: number;
  roughBase: number;
  roughVar: number;
  normalK: number;
}

export interface BarkSpecies {
  id: string;
  label: string;
  params: BarkParams;
}

export const BARK_TABLE: readonly BarkSpecies[] = [
  {
    id: "spruce",
    label: "Spruce",
    params: {
      plates: [16, 4], warp: 0.5, fissureW: 0.34, fissureDepth: 0.85, plateRound: 0.25,
      micro: 0.3, vertCrack: 0.55, lenticels: 0,
      deep: [0.045, 0.032, 0.026], high: [0.21, 0.155, 0.115], mottle: 0.25,
      roughBase: 0.92, roughVar: 0.07, normalK: 2.6,
    },
  },
  {
    id: "pine",
    label: "Pine",
    params: {
      plates: [7, 9], warp: 0.35, fissureW: 0.42, fissureDepth: 1.0, plateRound: 0.55,
      micro: 0.22, vertCrack: 0.1, lenticels: 0,
      deep: [0.05, 0.027, 0.016], high: [0.30, 0.155, 0.075], mottle: 0.35,
      roughBase: 0.88, roughVar: 0.1, normalK: 3.0,
    },
  },
  {
    id: "beech",
    label: "Beech",
    params: {
      plates: [5, 5], warp: 0.6, fissureW: 0.85, fissureDepth: 0.12, plateRound: 0.1,
      micro: 0.12, vertCrack: 0, lenticels: 0,
      deep: [0.16, 0.15, 0.135], high: [0.30, 0.285, 0.25], mottle: 0.5,
      roughBase: 0.78, roughVar: 0.08, normalK: 0.9,
    },
  },
  {
    id: "birch",
    label: "Birch",
    params: {
      plates: [4, 3], warp: 0.3, fissureW: 0.9, fissureDepth: 0.06, plateRound: 0.05,
      micro: 0.1, vertCrack: 0, lenticels: 1,
      deep: [0.46, 0.44, 0.42], high: [0.80, 0.79, 0.76], mottle: 0.22,
      roughBase: 0.62, roughVar: 0.18, normalK: 0.7,
    },
  },
  {
    id: "karst_gnarl",
    label: "Karst gnarl",
    params: {
      plates: [9, 3], warp: 1.4, fissureW: 0.5, fissureDepth: 0.9, plateRound: 0.3,
      micro: 0.34, vertCrack: 0.3, lenticels: 0,
      deep: [0.05, 0.043, 0.036], high: [0.205, 0.18, 0.15], mottle: 0.3,
      roughBase: 0.93, roughVar: 0.05, normalK: 2.8,
    },
  },
  {
    id: "snag",
    label: "Snag",
    params: {
      plates: [11, 2], warp: 0.4, fissureW: 0.3, fissureDepth: 0.7, plateRound: 0.15,
      micro: 0.26, vertCrack: 0.8, lenticels: 0,
      deep: [0.07, 0.065, 0.06], high: [0.26, 0.25, 0.23], mottle: 0.2,
      roughBase: 0.9, roughVar: 0.06, normalK: 2.2,
    },
  },
];

export interface BarkBakeConfig {
  layer: number;
  seed: number;
  resolution?: number;
}

export interface BarkTextures {
  resolution: number;
  species: BarkSpecies;
  dataA: Float32Array;
  dataB: Float32Array;
  texA: THREE.DataTexture;
  texB: THREE.DataTexture;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function pfbm(x: number, y: number, octaves: number, period: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let scale = 1;
  for (let i = 0; i < octaves; i++) {
    sum += periodicValueNoise2(x * scale, y * scale, period * scale, seed + i * 7) * amp;
    amp *= 0.5;
    scale *= 2;
  }
  return sum;
}

function barkHeight(params: BarkParams, u: number, v: number, seed: number): number {
  const warpX = (pfbm(u * 6, v * 6, 2, 6, seed + 31) - 0.5) * params.warp * 0.12;
  const warpY = (pfbm(u * 6, v * 6, 2, 6, seed + 67) - 0.5) * params.warp * 0.12;
  const qx = u + warpX;
  const qy = v + warpY;
  const plates = periodicWorleyF1Edge(
    qx * params.plates[0],
    qy * params.plates[1],
    params.plates[0],
    params.plates[1],
    seed,
  );
  const fissure = clamp01(plates.edge / Math.max(params.fissureW, 0.0001));
  let height = Math.pow(fissure, 0.65) * params.fissureDepth + plates.f1 * params.plateRound;
  if (params.vertCrack > 0) {
    const lanes = Math.max(1, Math.round(params.plates[0] * 0.5));
    const crackPhase = qx * lanes + pfbm(qx * 3, qy * 3, 2, 3, seed + 5) * 1.4;
    const crack = Math.abs((crackPhase - Math.floor(crackPhase)) - 0.5) * 2;
    height *= Math.pow(clamp01(crack / 0.22), 0.5) * params.vertCrack + (1 - params.vertCrack);
  }
  height += (pfbm(u * 24, v * 24, 3, 24, seed + 91) - 0.5) * params.micro;
  return height;
}

function makeBarkTexture(data: Float32Array, resolution: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(data as Float32Array<ArrayBuffer>, resolution, resolution, THREE.RGBAFormat, THREE.FloatType);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export function bakeBarkTextures(config: BarkBakeConfig): BarkTextures {
  const species = BARK_TABLE[((Math.floor(config.layer) % BARK_TABLE.length) + BARK_TABLE.length) % BARK_TABLE.length];
  const params = species.params;
  const resolution = Math.max(2, Math.floor(config.resolution ?? BARK_RES));
  const dataA = new Float32Array(resolution * resolution * 4);
  const dataB = new Float32Array(resolution * resolution * 4);
  const e = 1.6 / resolution;

  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      const u = (x + 0.5) / resolution;
      const v = (y + 0.5) / resolution;
      const height = barkHeight(params, u, v, config.seed);
      const hx0 = barkHeight(params, u - e, v, config.seed);
      const hx1 = barkHeight(params, u + e, v, config.seed);
      const hy0 = barkHeight(params, u, v - e, config.seed);
      const hy1 = barkHeight(params, u, v + e, config.seed);
      const nx = (hx0 - hx1) * params.normalK * 0.5;
      const ny = (hy0 - hy1) * params.normalK * 0.5;
      const invLen = 1 / Math.max(Math.hypot(nx, ny, 1), 0.0001);
      const h01 = clamp01(height);
      const mottle = (periodicValueNoise2(u * 2, v * 2, 2, config.seed + 201) - 0.5) * params.mottle;
      let r = (params.deep[0] + (params.high[0] - params.deep[0]) * h01) * (1 + mottle);
      let g = (params.deep[1] + (params.high[1] - params.deep[1]) * h01) * (1 + mottle);
      let b = (params.deep[2] + (params.high[2] - params.deep[2]) * h01) * (1 + mottle);
      if (params.lenticels > 0) {
        const dash = 1 - clamp01((periodicWorleyF1Edge(u * 5, v * 24, 5, 24, config.seed + 77).f1 - 0.2) / 0.22);
        r = r + (0.045 - r) * dash * 0.85;
        g = g + (0.04 - g) * dash * 0.85;
        b = b + (0.038 - b) * dash * 0.85;
      }
      const rough = clamp01(params.roughBase + (height - 0.5) * params.roughVar * 2);
      const i = (y * resolution + x) * 4;
      dataA[i] = Math.sqrt(clamp01(r));
      dataA[i + 1] = Math.sqrt(clamp01(g));
      dataA[i + 2] = Math.sqrt(clamp01(b));
      dataA[i + 3] = clamp01(height) * 0.7 + 0.3;
      dataB[i] = nx * invLen * 0.5 + 0.5;
      dataB[i + 1] = ny * invLen * 0.5 + 0.5;
      dataB[i + 2] = Math.max(0.3, Math.min(1, rough));
      dataB[i + 3] = h01;
    }
  }

  return {
    resolution,
    species,
    dataA,
    dataB,
    texA: makeBarkTexture(dataA, resolution),
    texB: makeBarkTexture(dataB, resolution),
  };
}
