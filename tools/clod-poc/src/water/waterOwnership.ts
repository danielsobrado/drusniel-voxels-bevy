export type WaterRenderOwner = "clipmap" | "deep_ocean" | "hidden" | "fallback" | "terrain_clod";

export interface WaterOwnershipStats {
  clipmapSurfaces: number;
  deepOceanSurfaces: number;
  hiddenSurfaces: number;
  fallbackSurfaces: number;
  terrainClodSurfaces: number;
}

export interface WaterOwnershipInput {
  waterEnabled: boolean;
  clipmapEnabled: boolean;
  deepOceanEnabled: boolean;
  fallbackUsed?: boolean;
}

export const EMPTY_WATER_OWNERSHIP_STATS: WaterOwnershipStats = Object.freeze({
  clipmapSurfaces: 0,
  deepOceanSurfaces: 0,
  hiddenSurfaces: 0,
  fallbackSurfaces: 0,
  terrainClodSurfaces: 0,
});

export function createWaterOwnershipStats(input: WaterOwnershipInput): WaterOwnershipStats {
  if (!input.waterEnabled) {
    return {
      ...EMPTY_WATER_OWNERSHIP_STATS,
      hiddenSurfaces: 1,
    };
  }

  return {
    clipmapSurfaces: input.clipmapEnabled ? 1 : 0,
    deepOceanSurfaces: input.deepOceanEnabled ? 1 : 0,
    hiddenSurfaces: 0,
    fallbackSurfaces: input.fallbackUsed ? 1 : 0,
    terrainClodSurfaces: 0,
  };
}

export function assertWaterOwnershipIsRuntimeOnly(stats: WaterOwnershipStats): void {
  if (stats.terrainClodSurfaces !== 0) {
    throw new Error(
      `[water-ownership] invalid ownership: ${stats.terrainClodSurfaces} water surface(s) assigned to CLOD terrain pages`,
    );
  }
}

export function summarizeWaterOwnership(stats: WaterOwnershipStats): Record<WaterRenderOwner, number> {
  return {
    clipmap: stats.clipmapSurfaces,
    deep_ocean: stats.deepOceanSurfaces,
    hidden: stats.hiddenSurfaces,
    fallback: stats.fallbackSurfaces,
    terrain_clod: stats.terrainClodSurfaces,
  };
}
