import type { HeightfieldSampler } from "../heightfield_sampler.js";
import { tileOriginM } from "../tile_key.js";
import { heightfieldTileSample, type HeightfieldTile } from "./heightfield_tile.js";

export interface SurfaceCacheParityResult {
  samples: number;
  maxErrorM: number;
}

export function measureSurfaceCacheParity(
  residentTiles: readonly HeightfieldTile[],
  fallback: Pick<HeightfieldSampler, "sampleHeight">,
  sampleCount: number,
  seed: number,
): SurfaceCacheParityResult {
  const count = Math.max(0, Math.floor(sampleCount));
  if (residentTiles.length === 0 || count === 0) return { samples: 0, maxErrorM: 0 };
  let state = (Math.floor(seed) >>> 0) || 1;
  let maxErrorM = 0;
  for (let index = 0; index < count; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const tile = residentTiles[state % residentTiles.length]!;
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const localX = state % tile.res;
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const localZ = state % tile.res;
    const cachedHeight = heightfieldTileSample(tile, localX, localZ);
    const origin = tileOriginM(tile.key);
    const fallbackHeight = fallback.sampleHeight(origin.x + localX, origin.z + localZ);
    const error = Math.abs(cachedHeight - fallbackHeight);
    if (!Number.isFinite(error)) return { samples: index + 1, maxErrorM: Number.POSITIVE_INFINITY };
    maxErrorM = Math.max(maxErrorM, error);
  }
  return { samples: count, maxErrorM };
}
