import type {
  CoastConfig,
  WorldBoundsConfig,
} from "../config/borderCoastOceanConfig.js";
import {
  computeBorderDistance,
  type BorderNormal,
  type BorderPosition,
} from "./borderDistance.js";
import {
  blendCoastTypes,
  dominantCoastType,
  selectCoastType,
  type CoastType,
  type CoastWeights,
} from "./coastTypes.js";

export interface CoastMaskSample {
  inCoastBand: boolean;
  coastAlpha: number;
  bandT: number;
  distortedDistanceToBorder: number;
  nearestBorderNormal: BorderNormal;
  stableSegmentId: number;
  coastType: CoastType;
  weights: CoastWeights;
}

interface RoundedBorderSample {
  signedDistance: number;
  normal: BorderNormal;
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

function hash2(x: number, z: number, seed: number): number {
  const value = (seed >>> 0)
    ^ Math.imul(x, 0x1f123bb5)
    ^ Math.imul(z, 0x5f356495);
  return mix32(value) / 0x100000000;
}

function valueNoise2(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = smoothstep(0, 1, x - x0);
  const tz = smoothstep(0, 1, z - z0);
  const south = hash2(x0, z0, seed) * (1 - tx) + hash2(x0 + 1, z0, seed) * tx;
  const north = hash2(x0, z0 + 1, seed) * (1 - tx) + hash2(x0 + 1, z0 + 1, seed) * tx;
  return (south * (1 - tz) + north * tz) * 2 - 1;
}

function roundedBorder(
  pos: BorderPosition,
  bounds: WorldBoundsConfig,
  cornerRadius: number,
): RoundedBorderSample {
  const centerX = (bounds.min_x + bounds.max_x) * 0.5;
  const centerZ = (bounds.min_z + bounds.max_z) * 0.5;
  const halfX = (bounds.max_x - bounds.min_x) * 0.5;
  const halfZ = (bounds.max_z - bounds.min_z) * 0.5;
  const radius = Math.min(Math.max(0, cornerRadius), halfX, halfZ);
  const localX = pos.x - centerX;
  const localZ = pos.z - centerZ;
  const qx = Math.abs(localX) - (halfX - radius);
  const qz = Math.abs(localZ) - (halfZ - radius);
  const outsideX = Math.max(qx, 0);
  const outsideZ = Math.max(qz, 0);
  const rectangleSdf = Math.hypot(outsideX, outsideZ) + Math.min(Math.max(qx, qz), 0) - radius;

  let normalX = 0;
  let normalZ = 0;
  if (qx > 0 && qz > 0) {
    const length = Math.hypot(qx, qz);
    normalX = Math.sign(localX) * qx / length;
    normalZ = Math.sign(localZ) * qz / length;
  } else if (qx >= qz) {
    normalX = Math.sign(localX) || 1;
  } else {
    normalZ = Math.sign(localZ) || 1;
  }

  return {
    signedDistance: -rectangleSdf,
    normal: { x: normalX, z: normalZ },
  };
}

function perimeterCoordinate(
  pos: BorderPosition,
  bounds: WorldBoundsConfig,
  normal: BorderNormal,
): number {
  const width = bounds.max_x - bounds.min_x;
  const height = bounds.max_z - bounds.min_z;
  const x = Math.min(width, Math.max(0, pos.x - bounds.min_x));
  const z = Math.min(height, Math.max(0, pos.z - bounds.min_z));

  if (normal.z < 0 && Math.abs(normal.z) >= Math.abs(normal.x)) return x;
  if (normal.x > 0 && Math.abs(normal.x) >= Math.abs(normal.z)) return width + z;
  if (normal.z > 0 && Math.abs(normal.z) >= Math.abs(normal.x)) return width + height + (width - x);
  return width * 2 + height + (height - z);
}

function wrapSegment(segmentId: number, segmentCount: number): number {
  return ((segmentId % segmentCount) + segmentCount) % segmentCount;
}

export function sampleCoastMask(
  pos: BorderPosition,
  bounds: WorldBoundsConfig,
  config: CoastConfig,
  seed: number,
): CoastMaskSample {
  const border = computeBorderDistance(pos, bounds);
  const rounded = roundedBorder(pos, bounds, config.band.corner_rounding_m);
  const noiseSeed = mix32((seed >>> 0) ^ (config.seed_offset >>> 0));
  const noise = valueNoise2(
    pos.x * config.band.coastline_noise_scale,
    pos.z * config.band.coastline_noise_scale,
    noiseSeed,
  );
  const distortedDistanceToBorder = rounded.signedDistance
    + noise * config.band.coastline_noise_strength_m;
  const width = config.band.width_m;
  const bandT = clamp01(distortedDistanceToBorder / width);
  const outerAlpha = smoothstep(
    -config.band.outer_fade_m,
    0,
    distortedDistanceToBorder,
  );
  const innerAlpha = 1 - smoothstep(
    Math.max(0, width - config.band.inner_fade_m),
    width,
    distortedDistanceToBorder,
  );
  const coastAlpha = config.enabled && border.inside ? outerAlpha * innerAlpha : 0;
  const inCoastBand = coastAlpha > 0;

  const perimeter = 2 * (
    bounds.max_x - bounds.min_x
    + bounds.max_z - bounds.min_z
  );
  const segmentCount = Math.max(4, Math.round(perimeter / config.band.segment_length_m));
  const segmentLength = perimeter / segmentCount;
  const perimeterT = perimeterCoordinate(pos, bounds, rounded.normal) / segmentLength;
  const centeredSegment = perimeterT - 0.5;
  const firstUnwrapped = Math.floor(centeredSegment);
  const blendT = smoothstep(0, 1, centeredSegment - firstUnwrapped);
  const firstSegment = wrapSegment(firstUnwrapped, segmentCount);
  const secondSegment = wrapSegment(firstUnwrapped + 1, segmentCount);
  const typeSeed = mix32(noiseSeed ^ 0x6d2b79f5);
  const firstType = selectCoastType(typeSeed, firstSegment, config.type_weights);
  const secondType = selectCoastType(typeSeed, secondSegment, config.type_weights);
  const weights = blendCoastTypes(firstType, secondType, blendT);

  return {
    inCoastBand,
    coastAlpha,
    bandT,
    distortedDistanceToBorder,
    nearestBorderNormal: rounded.normal,
    stableSegmentId: blendT < 0.5 ? firstSegment : secondSegment,
    coastType: dominantCoastType(weights),
    weights,
  };
}
