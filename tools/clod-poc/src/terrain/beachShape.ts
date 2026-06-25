import type { BeachConfig, CoastBandConfig } from "../config/borderCoastOceanConfig.js";

export interface BeachShapeInput {
  baseHeight: number;
  waterLevel: number;
  distortedDistanceToBorder: number;
  coastInfluence: number;
  x: number;
  z: number;
  seed: number;
  band: CoastBandConfig;
  beach: BeachConfig;
}

export interface BeachShapeResult {
  height: number;
  drySand: number;
  wetSand: number;
  shallowSeabed: number;
  duneGrass: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function mix32(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

function hash01(x: number, z: number, seed: number): number {
  return mix32(
    (seed >>> 0)
    ^ Math.imul(x, 0x1f123bb5)
    ^ Math.imul(z, 0x5f356495),
  ) / 0x100000000;
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

export function shapeBeach(input: BeachShapeInput): BeachShapeResult {
  const distance = input.distortedDistanceToBorder;
  const widthNoise = noise2(
    input.x * input.band.coastline_noise_scale,
    input.z * input.band.coastline_noise_scale,
    input.seed,
  );
  const beachWidth = input.beach.min_width_m
    + (input.beach.max_width_m - input.beach.min_width_m) * (widthNoise * 0.5 + 0.5);
  const shoreProfile = input.waterLevel + distance * input.beach.slope;
  const inlandBlend = smoothstep(
    Math.max(input.beach.min_width_m, beachWidth - input.band.inner_fade_m),
    beachWidth,
    Math.max(0, distance),
  );

  const duneStart = Math.max(input.beach.wet_sand_width_m, beachWidth - input.band.inner_fade_m);
  const duneBand = smoothstep(duneStart, beachWidth, distance)
    * (1 - smoothstep(beachWidth, beachWidth + input.band.inner_fade_m, distance));
  const duneNoise = noise2(
    input.x * (input.band.coastline_noise_scale + 1 / input.band.segment_length_m),
    input.z * (input.band.coastline_noise_scale + 1 / input.band.segment_length_m),
    input.seed ^ 0x51ed270b,
  );
  const duneHeight = duneBand
    * (input.beach.dune_height_m + duneNoise * input.beach.dune_noise_strength_m);
  const targetHeight = shoreProfile + Math.max(0, duneHeight);
  const shapedHeight = targetHeight * (1 - inlandBlend) + input.baseHeight * inlandBlend;
  const height = input.baseHeight
    + (shapedHeight - input.baseHeight) * clamp01(input.coastInfluence);

  const seabed = 1 - smoothstep(0, input.beach.wet_sand_width_m, distance);
  const wet = smoothstep(0, input.beach.wet_sand_width_m, distance)
    * (1 - smoothstep(
      input.beach.wet_sand_width_m,
      input.beach.wet_sand_width_m * 2,
      distance,
    ));
  const dry = smoothstep(input.beach.wet_sand_width_m, input.beach.wet_sand_width_m * 2, distance)
    * (1 - smoothstep(duneStart, beachWidth, distance));

  return {
    height,
    drySand: dry,
    wetSand: wet,
    shallowSeabed: seabed,
    duneGrass: duneBand,
  };
}
