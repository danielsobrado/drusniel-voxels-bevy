export interface BiomeRegionContract {
  regionCellM: number;
  oceanHeightMarginM: number;
  oceanIslandMaskMax: number;
  coastHeightBandM: number;
  coastShoreDistanceM: number;
  mountainHeightAboveSeaM: number;
  swampHeightAboveSeaM: number;
  swampNoiseMax: number;
  plainsDistanceMin: number;
  plainsNoiseMin: number;
  forestNoiseMin: number;
}

export const BIOME_REGION_CONTRACT: Readonly<BiomeRegionContract> = Object.freeze({
  regionCellM: 420,
  oceanHeightMarginM: 1.5,
  oceanIslandMaskMax: 0.08,
  coastHeightBandM: 4,
  coastShoreDistanceM: 42,
  mountainHeightAboveSeaM: 48,
  swampHeightAboveSeaM: 8,
  swampNoiseMax: 0.42,
  plainsDistanceMin: 0.72,
  plainsNoiseMin: 0.58,
  forestNoiseMin: 0.46,
});

export const BIOME_REGION_CELL_M = BIOME_REGION_CONTRACT.regionCellM;
export const BIOME_OCEAN_HEIGHT_MARGIN_M = BIOME_REGION_CONTRACT.oceanHeightMarginM;
export const BIOME_OCEAN_ISLAND_MASK_MAX = BIOME_REGION_CONTRACT.oceanIslandMaskMax;
export const BIOME_COAST_HEIGHT_BAND_M = BIOME_REGION_CONTRACT.coastHeightBandM;
export const BIOME_COAST_SHORE_DISTANCE_M = BIOME_REGION_CONTRACT.coastShoreDistanceM;
export const BIOME_MOUNTAIN_HEIGHT_ABOVE_SEA_M = BIOME_REGION_CONTRACT.mountainHeightAboveSeaM;
export const BIOME_SWAMP_HEIGHT_ABOVE_SEA_M = BIOME_REGION_CONTRACT.swampHeightAboveSeaM;
export const BIOME_SWAMP_NOISE_MAX = BIOME_REGION_CONTRACT.swampNoiseMax;
export const BIOME_PLAINS_DISTANCE_MIN = BIOME_REGION_CONTRACT.plainsDistanceMin;
export const BIOME_PLAINS_NOISE_MIN = BIOME_REGION_CONTRACT.plainsNoiseMin;
export const BIOME_FOREST_NOISE_MIN = BIOME_REGION_CONTRACT.forestNoiseMin;

export function resolveBiomeRegionContract(overrides?: Partial<BiomeRegionContract>): BiomeRegionContract {
  return {
    ...BIOME_REGION_CONTRACT,
    ...overrides,
  };
}
