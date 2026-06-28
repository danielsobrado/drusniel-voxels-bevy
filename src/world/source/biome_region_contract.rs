use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct BiomeRegionContract {
    pub region_cell_m: f32,
    pub ocean_height_margin_m: f32,
    pub ocean_island_mask_max: f32,
    pub coast_height_band_m: f32,
    pub coast_shore_distance_m: f32,
    pub mountain_height_above_sea_m: f32,
    pub swamp_height_above_sea_m: f32,
    pub swamp_noise_max: f32,
    pub plains_distance_min: f32,
    pub plains_noise_min: f32,
    pub forest_noise_min: f32,
}

pub const BIOME_REGION_CONTRACT: BiomeRegionContract = BiomeRegionContract {
    region_cell_m: 420.0,
    ocean_height_margin_m: 1.5,
    ocean_island_mask_max: 0.08,
    coast_height_band_m: 4.0,
    coast_shore_distance_m: 42.0,
    mountain_height_above_sea_m: 68.0,
    swamp_height_above_sea_m: 8.0,
    swamp_noise_max: 0.42,
    plains_distance_min: 0.72,
    plains_noise_min: 0.58,
    forest_noise_min: 0.46,
};

pub const BIOME_REGION_CELL_M: f32 = BIOME_REGION_CONTRACT.region_cell_m;
pub const BIOME_OCEAN_HEIGHT_MARGIN_M: f32 = BIOME_REGION_CONTRACT.ocean_height_margin_m;
pub const BIOME_OCEAN_ISLAND_MASK_MAX: f32 = BIOME_REGION_CONTRACT.ocean_island_mask_max;
pub const BIOME_COAST_HEIGHT_BAND_M: f32 = BIOME_REGION_CONTRACT.coast_height_band_m;
pub const BIOME_COAST_SHORE_DISTANCE_M: f32 = BIOME_REGION_CONTRACT.coast_shore_distance_m;
pub const BIOME_MOUNTAIN_HEIGHT_ABOVE_SEA_M: f32 = BIOME_REGION_CONTRACT.mountain_height_above_sea_m;
pub const BIOME_SWAMP_HEIGHT_ABOVE_SEA_M: f32 = BIOME_REGION_CONTRACT.swamp_height_above_sea_m;
pub const BIOME_SWAMP_NOISE_MAX: f32 = BIOME_REGION_CONTRACT.swamp_noise_max;
pub const BIOME_PLAINS_DISTANCE_MIN: f32 = BIOME_REGION_CONTRACT.plains_distance_min;
pub const BIOME_PLAINS_NOISE_MIN: f32 = BIOME_REGION_CONTRACT.plains_noise_min;
pub const BIOME_FOREST_NOISE_MIN: f32 = BIOME_REGION_CONTRACT.forest_noise_min;
