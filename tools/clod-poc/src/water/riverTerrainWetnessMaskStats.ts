import type * as THREE from "three";

export interface RiverTerrainWetnessMaskStats {
  enabled: boolean;
  width: number;
  height: number;
  wetPixels: number;
  foamPixels: number;
  dropletPixels: number;
  maxWet: number;
  maxFoam: number;
  maxDroplets: number;
}

const EMPTY_RIVER_TERRAIN_WETNESS_MASK_STATS: RiverTerrainWetnessMaskStats = Object.freeze({
  enabled: false,
  width: 0,
  height: 0,
  wetPixels: 0,
  foamPixels: 0,
  dropletPixels: 0,
  maxWet: 0,
  maxFoam: 0,
  maxDroplets: 0,
});

export function collectRiverTerrainWetnessMaskStats(
  texture: THREE.DataTexture | null | undefined,
): RiverTerrainWetnessMaskStats {
  if (!texture) return { ...EMPTY_RIVER_TERRAIN_WETNESS_MASK_STATS };

  const image = texture.image as { width?: number; height?: number; data?: ArrayLike<number> } | undefined;
  const width = Math.max(0, Math.floor(image?.width ?? 0));
  const height = Math.max(0, Math.floor(image?.height ?? 0));
  const data = image?.data;
  if (!data || width === 0 || height === 0) return { ...EMPTY_RIVER_TERRAIN_WETNESS_MASK_STATS };

  let wetPixels = 0;
  let foamPixels = 0;
  let dropletPixels = 0;
  let maxWet = 0;
  let maxFoam = 0;
  let maxDroplets = 0;

  for (let i = 0; i < data.length; i += 4) {
    const wet = data[i] ?? 0;
    const foam = data[i + 1] ?? 0;
    const droplets = data[i + 2] ?? 0;
    if (wet > 0) wetPixels += 1;
    if (foam > 0) foamPixels += 1;
    if (droplets > 0) dropletPixels += 1;
    maxWet = Math.max(maxWet, wet);
    maxFoam = Math.max(maxFoam, foam);
    maxDroplets = Math.max(maxDroplets, droplets);
  }

  return {
    enabled: true,
    width,
    height,
    wetPixels,
    foamPixels,
    dropletPixels,
    maxWet,
    maxFoam,
    maxDroplets,
  };
}
