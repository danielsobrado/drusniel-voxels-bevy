import { sampleIslandMask, type IslandMaskSample, type IslandShapeConfig } from "./island_shape.js";

export const BIOME_IDS = {
  meadows: 0,
  forest: 1,
  swamp: 2,
  mountain: 3,
  plains: 4,
  coast: 5,
  ocean: 6,
} as const;

export type BiomeId = typeof BIOME_IDS[keyof typeof BIOME_IDS];

export interface BiomeRegionSample {
  biome: BiomeId;
  regionNoise: number;
  islandDistanceT: number;
}

export interface BiomeRegionFieldOptions {
  seed: number;
  seaLevel: number;
  regionCellM?: number;
  islandShape?: Partial<IslandShapeConfig>;
}

export interface BiomeRegionClassifyInput {
  x: number;
  z: number;
  height: number;
  seed: number;
  seaLevel: number;
  regionCellM: number;
  islandRadiusM: number;
  island: IslandMaskSample;
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

export function pcg2d(x: number, z: number, seed: number): number {
  const value = (seed >>> 0)
    ^ Math.imul(x | 0, 0x1f123bb5)
    ^ Math.imul(z | 0, 0x5f356495);
  return mix32(value) / 0x100000000;
}

function smooth01(value: number): number {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

export function biomeRegionNoise(x: number, z: number, cellM: number, seed: number): number {
  const gx = x / cellM;
  const gz = z / cellM;
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const tx = smooth01(gx - x0);
  const tz = smooth01(gz - z0);
  const a = pcg2d(x0, z0, seed);
  const b = pcg2d(x0 + 1, z0, seed);
  const c = pcg2d(x0, z0 + 1, seed);
  const d = pcg2d(x0 + 1, z0 + 1, seed);
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

export function classifyBiomeRegion(input: BiomeRegionClassifyInput): BiomeRegionSample {
  const { x, z, height, seed, seaLevel, regionCellM, islandRadiusM, island } = input;
  if (height < seaLevel - 1.5 || island.mask < 0.08) {
    return { biome: BIOME_IDS.ocean, regionNoise: 0, islandDistanceT: 0 };
  }
  if (Math.abs(height - seaLevel) < 4 || island.shoreDistanceM < 42) {
    return { biome: BIOME_IDS.coast, regionNoise: 0, islandDistanceT: 0 };
  }

  const n = biomeRegionNoise(x, z, regionCellM, seed + 711);
  const centerDistance = Math.hypot(x - island.nearestCenterX, z - island.nearestCenterZ);
  const distanceT = Math.min(1, Math.max(0, centerDistance / Math.max(1, islandRadiusM)));

  if (height >= seaLevel + 68) return { biome: BIOME_IDS.mountain, regionNoise: n, islandDistanceT: distanceT };
  if (height <= seaLevel + 8 && n < 0.42) return { biome: BIOME_IDS.swamp, regionNoise: n, islandDistanceT: distanceT };
  if (distanceT > 0.72 && n > 0.58) return { biome: BIOME_IDS.plains, regionNoise: n, islandDistanceT: distanceT };
  if (n > 0.46) return { biome: BIOME_IDS.forest, regionNoise: n, islandDistanceT: distanceT };
  return { biome: BIOME_IDS.meadows, regionNoise: n, islandDistanceT: distanceT };
}

export class BiomeRegionField {
  readonly seed: number;
  readonly seaLevel: number;
  readonly regionCellM: number;
  readonly islandShape?: Partial<IslandShapeConfig>;

  constructor(options: BiomeRegionFieldOptions) {
    this.seed = Math.floor(options.seed);
    this.seaLevel = options.seaLevel;
    this.regionCellM = Math.max(64, options.regionCellM ?? 420);
    this.islandShape = options.islandShape;
  }

  sample(x: number, z: number, height: number): BiomeRegionSample {
    return classifyBiomeRegion({
      x,
      z,
      height,
      seed: this.seed,
      seaLevel: this.seaLevel,
      regionCellM: this.regionCellM,
      islandRadiusM: this.islandShape?.radiusM ?? 560,
      island: sampleIslandMask(x, z, this.islandShape),
    });
  }
}
