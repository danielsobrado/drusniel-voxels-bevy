pub mod biome_region_field;
pub mod height_field;
pub mod island_shape;
pub mod noise;
pub mod splat;
pub mod terrain_bridge;
pub mod world_source;

pub use biome_region_field::{
    BiomeId, BiomeRegionField, BiomeRegionSample, BIOME_COAST_HEIGHT_BAND_M,
    BIOME_COAST_SHORE_DISTANCE_M, BIOME_FOREST_NOISE_MIN, BIOME_MOUNTAIN_HEIGHT_ABOVE_SEA_M,
    BIOME_OCEAN_HEIGHT_MARGIN_M, BIOME_OCEAN_ISLAND_MASK_MAX, BIOME_PLAINS_DISTANCE_MIN,
    BIOME_PLAINS_NOISE_MIN, BIOME_REGION_CELL_M, BIOME_SWAMP_HEIGHT_ABOVE_SEA_M,
    BIOME_SWAMP_NOISE_MAX,
};
pub use height_field::base_surface_height;
pub use island_shape::{sample_island_mask, IslandMaskSample, IslandShapeConfig};
pub use splat::{sample_biome_splat, BiomeSplatSample, MaterialLayerId};
pub use terrain_bridge::{ProceduralWorldSourceTerrainBridge, WorldSourceTerrainBridge};
pub use world_source::{
    ProceduralWorldSource, TerrainFieldConfig, WorldSource, WorldSourceBounds, WorldSourceMetadata,
    WORLD_SOURCE_CONFIG_PATH,
};
