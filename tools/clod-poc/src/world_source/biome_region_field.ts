import { resolveIslandShapeConfig, sampleIslandMask, type IslandMaskSample, type IslandShapeConfig } from "./island_shape.js";

export const BIOME_IDS = {
  meadows: 0,
  forest: 1,
  swamp: 2,
  mountain: 3,
  plains: 4,
  coast: 5,
  ocean: 6,
} as const;

export const BIOME_REGION_CELL_M = 420;
export const BIOME_OCEAN_HEIGHT_MARGIN_M = 1.5;
export const BIOME_OCEAN_ISLAND_MASK_MAX = 0.08;
export const BIOME_COAST_HEIGHT_BAND_M = 4;
export const BIOME_COAST_SHORE_DISTANCE_M = 42;
export const BIOME_MOUNTAIN_HEIGHT_ABOVE_SEA_M = 68;
export const BIOME_SWAMP_HEIGHT_ABOVE_SEA_M = 8;
export const BIOME_SWAMP_NOISE_MAX = 0.42;
export const BIOME_PLAINS_DISTANCE_MIN = 0.72;
export const BIOME_PLAINS_NOISE_MIN = 0.58;
export const BIOME_FOREST_NOISE_MIN = 0.46;

export type BiomeId = typeof BIOME_IDS[keyof typeof BIOME_IDS];

export interface BiomeRegionSample {
  biome: BiomeId;
  regionNoise: number;
  islandDistanceT: number;
}

export interface BiomeRegionFieldOptions {
  seed: number;
  seaLevel: number;
  /** Must stay equal to BIOME_REGION_CELL_M until WGSL accepts this as a uniform. */
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

function resolveRegionCellM(value: unknown): number {
  if (value === undefined) return BIOME_REGION_CELL_M;
  if (typeof value !== "number" || !Number.isFinite(value)) return BIOME_REGION_CELL_M;
  if (value !== BIOME_REGION_CELL_M) {
    throw new Error(`BiomeRegionField regionCellM must be ${BIOME_REGION_CELL_M} to match the GPU shader; got ${value}`);
  }
  return BIOME_REGION_CELL_M;
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
  const safeCellM = cellM === BIOME_REGION_CELL_M ? BIOME_REGION_CELL_M : resolveRegionCellM(cellM);
  const gx = x / safeCellM;
  const gz = z / safeCellM;
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
  if (height < seaLevel - BIOME_OCEAN_HEIGHT_MARGIN_M || island.mask < BIOME_OCEAN_ISLAND_MASK_MAX) {
    return { biome: BIOME_IDS.ocean, regionNoise: 0, islandDistanceT: 0 };
  }
  if (Math.abs(height - seaLevel) < BIOME_COAST_HEIGHT_BAND_M || island.shoreDistanceM < BIOME_COAST_SHORE_DISTANCE_M) {
    return { biome: BIOME_IDS.coast, regionNoise: 0, islandDistanceT: 0 };
  }

  const n = biomeRegionNoise(x, z, regionCellM, seed + 711);
  const centerDistance = Math.hypot(x - island.nearestCenterX, z - island.nearestCenterZ);
  const distanceT = Math.min(1, Math.max(0, centerDistance / Math.max(1, islandRadiusM)));

  if (height >= seaLevel + BIOME_MOUNTAIN_HEIGHT_ABOVE_SEA_M) return { biome: BIOME_IDS.mountain, regionNoise: n, islandDistanceT: distanceT };
  if (height <= seaLevel + BIOME_SWAMP_HEIGHT_ABOVE_SEA_M && n < BIOME_SWAMP_NOISE_MAX) return { biome: BIOME_IDS.swamp, regionNoise: n, islandDistanceT: distanceT };
  if (distanceT > BIOME_PLAINS_DISTANCE_MIN && n > BIOME_PLAINS_NOISE_MIN) return { biome: BIOME_IDS.plains, regionNoise: n, islandDistanceT: distanceT };
  if (n > BIOME_FOREST_NOISE_MIN) return { biome: BIOME_IDS.forest, regionNoise: n, islandDistanceT: distanceT };
  return { biome: BIOME_IDS.meadows, regionNoise: n, islandDistanceT: distanceT };
}

export class BiomeRegionField {
  readonly seed: number;
  readonly seaLevel: number;
  readonly regionCellM: number;
  readonly islandShape: IslandShapeConfig;

  constructor(options: BiomeRegionFieldOptions) {
    this.seed = Number.isFinite(options.seed) ? Math.floor(options.seed) : 0;
    this.seaLevel = Number.isFinite(options.seaLevel) ? options.seaLevel : 18;
    this.regionCellM = resolveRegionCellM(options.regionCellM);
    this.islandShape = resolveIslandShapeConfig({
      ...options.islandShape,
      seed: options.islandShape?.seed ?? this.seed,
      seaLevel: this.seaLevel,
    });
  }

  sample(x: number, z: number, height: number): BiomeRegionSample {
    return classifyBiomeRegion({
      x,
      z,
      height,
      seed: this.seed,
      seaLevel: this.seaLevel,
      regionCellM: this.regionCellM,
      islandRadiusM: this.islandShape.radiusM,
      island: sampleIslandMask(x, z, this.islandShape),
    });
  }
}
