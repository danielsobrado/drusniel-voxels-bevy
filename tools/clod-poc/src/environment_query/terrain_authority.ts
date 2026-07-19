import { gradient } from "../terrain/terrain_density.js";
import { getVoxelEditRevision, surfaceHeight, terrainWeights } from "../terrain/terrain.js";
import type { TerrainEnvironmentAuthority, TerrainEnvironmentSample } from "./terrain_adapter.js";

export function createLiveTerrainEnvironmentAuthority(): TerrainEnvironmentAuthority {
  return {
    sample: sampleLiveTerrainEnvironment,
  };
}

export function sampleLiveTerrainEnvironment(
  x: number,
  z: number,
  _hintM: number,
): TerrainEnvironmentSample {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return invalidTerrainSample();

  const height = surfaceHeight(x, z);
  if (!Number.isFinite(height)) return invalidTerrainSample();
  const normal = gradient(x, height, z);
  const weights = terrainWeights(height, normal[1]);
  const valid = normal.every(Number.isFinite) && weights.every(Number.isFinite);
  if (!valid) return invalidTerrainSample();

  return {
    height,
    normalX: normal[0],
    normalY: normal[1],
    normalZ: normal[2],
    grass: weights[0],
    rock: weights[1],
    sand: weights[2],
    snow: weights[3],
    valid: true,
    revision: getVoxelEditRevision(),
  };
}

function invalidTerrainSample(): TerrainEnvironmentSample {
  return {
    height: Number.NaN,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
    grass: 0,
    rock: 0,
    sand: 0,
    snow: 0,
    valid: false,
    revision: getVoxelEditRevision(),
  };
}
