import type { CliffConfig, CoastBandConfig } from "../config/borderCoastOceanConfig.js";

export interface CliffShapeInput {
  baseHeight: number;
  waterLevel: number;
  distortedDistanceToBorder: number;
  coastInfluence: number;
  x: number;
  z: number;
  seed: number;
  band: CoastBandConfig;
  cliff: CliffConfig;
}

export interface CliffShapeResult {
  height: number;
  cliffRock: number;
  beachRock: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function hash01(x: number, z: number, seed: number): number {
  let value = (seed >>> 0)
    ^ Math.imul(x, 0x1f123bb5)
    ^ Math.imul(z, 0x5f356495);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}

function noise2(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smoothstep(0, 1, x - ix);
  const fz = smoothstep(0, 1, z - iz);
  const a = hash01(ix, iz, seed);
  const b = hash01(ix + 1, iz, seed);
  const c = hash01(ix, iz + 1, seed);
  const d = hash01(ix + 1, iz + 1, seed);
  return ((a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz) * 2 - 1;
}

export function shapeCliff(input: CliffShapeInput): CliffShapeResult {
  const regionalNoise = noise2(
    input.x * input.band.coastline_noise_scale,
    input.z * input.band.coastline_noise_scale,
    input.seed,
  );
  const cliffHeight = input.cliff.min_height_m
    + (input.cliff.max_height_m - input.cliff.min_height_m) * (regionalNoise * 0.5 + 0.5);
  const faceWidth = Math.max(
    input.band.outer_fade_m,
    cliffHeight * (1 - input.cliff.face_steepness),
  );
  const faceT = smoothstep(0, faceWidth, input.distortedDistanceToBorder);
  const topBlendStart = Math.max(faceWidth, input.band.width_m - input.band.inner_fade_m);
  const inlandT = smoothstep(topBlendStart, input.band.width_m, input.distortedDistanceToBorder);

  const erosion = noise2(
    input.x * (input.band.coastline_noise_scale + 1 / input.band.segment_length_m),
    input.z * (input.band.coastline_noise_scale + 1 / input.band.segment_length_m),
    input.seed ^ 0x9e3779b9,
  ) * input.cliff.erosion_noise_strength_m;
  const ledgeNoise = noise2(
    input.x * (input.band.coastline_noise_scale + 1 / input.band.outer_fade_m),
    input.z * (input.band.coastline_noise_scale + 1 / input.band.outer_fade_m),
    input.seed ^ 0x6d2b79f5,
  );
  const ledgeGate = smoothstep(
    1 - input.cliff.ledge_probability,
    1,
    ledgeNoise * 0.5 + 0.5,
  );
  const ledgeProfile = Math.sin(faceT * Math.PI) * ledgeGate
    * input.cliff.erosion_noise_strength_m;
  const cliffSurface = input.waterLevel
    - input.band.outer_fade_m * input.cliff.face_steepness
    + faceT * cliffHeight
    + erosion * Math.sin(faceT * Math.PI)
    + ledgeProfile;
  const targetHeight = cliffSurface * (1 - inlandT) + input.baseHeight * inlandT;
  const height = input.baseHeight
    + (targetHeight - input.baseHeight) * clamp01(input.coastInfluence);

  return {
    height,
    cliffRock: smoothstep(0, faceWidth, input.distortedDistanceToBorder)
      * (1 - inlandT),
    beachRock: (1 - faceT) * (1 - inlandT),
  };
}
