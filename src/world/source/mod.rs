pub mod biome_content;
pub mod biome_material_id;
pub mod biome_region_contract;
pub mod biome_region_field;
pub mod drift_gate;
pub mod height_field;
pub mod island_shape;
pub mod noise;
pub mod splat;
pub mod terrain_bridge;
pub mod terrain_source_config;
pub mod terrain_source_diagnostics;
pub mod world_source;

#[cfg(test)]
mod golden_fixture_tests;

pub use biome_content::{BiomeContent, BiomeContentTable, BIOME_CONTENT_TABLE};
pub use biome_material_id::{material_base, material_biome, material_with_biome};
pub use biome_region_contract::{
    BiomeRegionContract, BIOME_COAST_HEIGHT_BAND_M, BIOME_COAST_SHORE_DISTANCE_M,
    BIOME_FOREST_NOISE_MIN, BIOME_MOUNTAIN_HEIGHT_ABOVE_SEA_M,
    BIOME_OCEAN_HEIGHT_MARGIN_M, BIOME_OCEAN_ISLAND_MASK_MAX, BIOME_PLAINS_DISTANCE_MIN,
    BIOME_PLAINS_NOISE_MIN, BIOME_REGION_CELL_M, BIOME_REGION_CONTRACT,
    BIOME_SWAMP_HEIGHT_ABOVE_SEA_M, BIOME_SWAMP_NOISE_MAX,
};
pub use biome_region_field::{BiomeId, BiomeRegionField, BiomeRegionSample};
pub use drift_gate::{
    evaluate_world_source_cpu_gpu_drift, evaluate_world_source_drift_gate,
    sample_cpu_world_source, WorldSourceDriftFailure, WorldSourceDriftFailureKind,
    WorldSourceDriftGateConfig, WorldSourceDriftGateReport, WorldSourceDriftGateStatus,
    WorldSourceDriftSample, WorldSourceDriftSamplePoint,
    WORLD_SOURCE_DRIFT_HEIGHT_TOLERANCE_M, WORLD_SOURCE_DRIFT_OCEAN_MASK_TOLERANCE,
};
pub use height_field::base_surface_height;
pub use island_shape::{sample_island_mask, IslandMaskSample, IslandShapeConfig};
pub use splat::{sample_biome_splat, BiomeSplatSample, MaterialLayerId};
pub use terrain_bridge::{ProceduralWorldSourceTerrainBridge, WorldSourceTerrainBridge};
pub use terrain_source_config::{TerrainSourceConfig, TerrainSourceMode, TERRAIN_SOURCE_CONFIG_PATH};
pub use terrain_source_diagnostics::{
    terrain_source_startup_report, TerrainSourceRuntimePath, TerrainSourceSelectionReason,
    TerrainSourceStartupReport,
};
pub use world_source::{
    ProceduralWorldSource, TerrainFieldConfig, WorldSource, WorldSourceBounds, WorldSourceMetadata,
    WORLD_SOURCE_CONFIG_PATH,
};
