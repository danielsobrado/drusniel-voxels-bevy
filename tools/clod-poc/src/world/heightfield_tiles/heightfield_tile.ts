import type { HeightfieldSampler } from "../heightfield_sampler.js";
import { tileOriginM, type WorldTileKey, WORLD_TILE_SIZE_M } from "../tile_key.js";
import {
  EMPTY_HEIGHTFIELD_TILE_COMPLEXITY,
  type HeightfieldTileComplexity,
} from "./heightfield_tile_complexity.js";

export const HEIGHTFIELD_TILE_SAMPLE_SPACING_M = 1;
export const HEIGHTFIELD_TILE_RES = WORLD_TILE_SIZE_M / HEIGHTFIELD_TILE_SAMPLE_SPACING_M + 1;
export const HEIGHTFIELD_TILE_SAMPLE_COUNT = HEIGHTFIELD_TILE_RES * HEIGHTFIELD_TILE_RES;
export const HEIGHTFIELD_TILE_BYTE_LENGTH = HEIGHTFIELD_TILE_SAMPLE_COUNT * Float32Array.BYTES_PER_ELEMENT;

export interface HeightfieldTile extends HeightfieldTileComplexity {
  readonly key: WorldTileKey;
  readonly res: number;
  readonly heights: Float32Array;
  readonly sourceRevision: number;
  readonly builtMs: number;
}

export interface HeightfieldTileField {
  sampleHeight(x: number, z: number): number;
  readonly sourceRevision?: number;
  readonly complexity?: HeightfieldTileComplexity;
}

function assertSourceRevision(sourceRevision: number): void {
  if (!Number.isSafeInteger(sourceRevision) || sourceRevision < 0) {
    throw new Error(`heightfield tile sourceRevision must be a non-negative safe integer: ${sourceRevision}`);
  }
}

export function buildHeightfieldTile(
  key: WorldTileKey,
  field: HeightfieldTileField | HeightfieldSampler,
  sourceRevision = field.sourceRevision ?? 0,
): HeightfieldTile {
  assertSourceRevision(sourceRevision);
  const origin = tileOriginM(key);
  const heights = new Float32Array(HEIGHTFIELD_TILE_SAMPLE_COUNT);
  const complexity = ("complexity" in field ? field.complexity : undefined) ?? EMPTY_HEIGHTFIELD_TILE_COMPLEXITY;
  const startedAt = performance.now();

  let index = 0;
  for (let z = 0; z < HEIGHTFIELD_TILE_RES; z++) {
    const worldZ = origin.z + z * HEIGHTFIELD_TILE_SAMPLE_SPACING_M;
    for (let x = 0; x < HEIGHTFIELD_TILE_RES; x++) {
      const worldX = origin.x + x * HEIGHTFIELD_TILE_SAMPLE_SPACING_M;
      heights[index++] = field.sampleHeight(worldX, worldZ);
    }
  }

  return {
    key: Object.freeze({ x: key.x, z: key.z }),
    res: HEIGHTFIELD_TILE_RES,
    heights,
    complexVolumeMask: complexity.complexVolumeMask,
    entranceMask: complexity.entranceMask,
    voxelRegionRefs: complexity.voxelRegionRefs,
    sourceRevision,
    builtMs: performance.now() - startedAt,
  };
}

export function heightfieldTileSample(tile: HeightfieldTile, localX: number, localZ: number): number {
  if (!Number.isInteger(localX) || !Number.isInteger(localZ)) return Number.NaN;
  if (localX < 0 || localZ < 0 || localX >= tile.res || localZ >= tile.res) return Number.NaN;
  return tile.heights[localZ * tile.res + localX] ?? Number.NaN;
}

export function heightfieldTileSampleBilinear(tile: HeightfieldTile, localX: number, localZ: number): number {
  if (!Number.isFinite(localX) || !Number.isFinite(localZ)) return Number.NaN;
  if (localX < 0 || localZ < 0 || localX > tile.res - 1 || localZ > tile.res - 1) return Number.NaN;
  const x0 = Math.floor(localX);
  const z0 = Math.floor(localZ);
  const x1 = Math.min(tile.res - 1, x0 + 1);
  const z1 = Math.min(tile.res - 1, z0 + 1);
  const fx = localX - x0;
  const fz = localZ - z0;
  const a = tile.heights[z0 * tile.res + x0]! * (1 - fx) + tile.heights[z0 * tile.res + x1]! * fx;
  const b = tile.heights[z1 * tile.res + x0]! * (1 - fx) + tile.heights[z1 * tile.res + x1]! * fx;
  return a * (1 - fz) + b * fz;
}
