pub mod biome_content;
pub mod biome_material_id;
pub mod biome_region_contract;
pub mod biome_region_field;
pub mod drift_gate;
pub mod drift_readback;
pub mod drift_readback_acceptance;
pub mod drift_readback_bridge;
pub mod drift_readback_render;
pub mod drift_readback_render_plugin;
pub mod drift_readback_request;
pub mod drift_readback_runtime_acceptance;
pub mod drift_readback_staging;
pub mod height_field;
pub mod island_shape;
pub mod noise;
pub mod splat;
pub mod terrain_bridge;
pub mod terrain_source_config;
pub mod terrain_source_diagnostics;
pub mod world_source;
pub mod azgaar;

#[cfg(test)]
mod golden_fixture_tests;

pub use biome_content::{BIOME_CONTENT_TABLE, BiomeContent, BiomeContentTable};
pub use biome_material_id::{material_base, material_biome, material_with_biome};
pub use biome_region_contract::{
    BIOME_COAST_HEIGHT_BAND_M, BIOME_COAST_SHORE_DISTANCE_M, BIOME_FOREST_NOISE_MIN,
    BIOME_MOUNTAIN_HEIGHT_ABOVE_SEA_M, BIOME_OCEAN_HEIGHT_MARGIN_M, BIOME_OCEAN_ISLAND_MASK_MAX,
    BIOME_PLAINS_DISTANCE_MIN, BIOME_PLAINS_NOISE_MIN, BIOME_REGION_CELL_M, BIOME_REGION_CONTRACT,
    BIOME_SWAMP_HEIGHT_ABOVE_SEA_M, BIOME_SWAMP_NOISE_MAX, BiomeRegionContract,
};
pub use biome_region_field::{BiomeId, BiomeRegionField, BiomeRegionSample};
pub use drift_gate::{
    WORLD_SOURCE_DRIFT_HEIGHT_TOLERANCE_M, WORLD_SOURCE_DRIFT_OCEAN_MASK_TOLERANCE,
    WorldSourceDriftFailure, WorldSourceDriftFailureKind, WorldSourceDriftGateConfig,
    WorldSourceDriftGateReport, WorldSourceDriftGateStatus, WorldSourceDriftSample,
    WorldSourceDriftSamplePoint, evaluate_world_source_cpu_gpu_drift,
    evaluate_world_source_drift_gate, sample_cpu_world_source,
};
pub use drift_readback::{
    GpuWorldSourceDriftInputSample, GpuWorldSourceDriftOutputSample,
    GpuWorldSourceDriftReadbackDispatchPlan, GpuWorldSourceDriftReadbackParams,
    StaticWorldSourceGpuReadback, UnavailableWorldSourceGpuReadback,
    WORLD_SOURCE_DRIFT_READBACK_SHADER_PATH, WORLD_SOURCE_DRIFT_READBACK_WORKGROUP_SIZE,
    WorldSourceGpuReadbackProvider, WorldSourceGpuReadbackResult, WorldSourceGpuReadbackStatus,
    build_gpu_world_source_drift_input_samples, decode_gpu_world_source_drift_outputs,
};
pub use drift_readback_acceptance::{
    WorldSourceGpuReadbackAcceptanceResult, evaluate_world_source_gpu_readback_acceptance,
    world_source_gpu_readback_acceptance_blockers,
};
pub use drift_readback_bridge::{
    GpuWorldSourceDriftReadbackSharedResult, publish_gpu_world_source_drift_readback_result,
};
pub use drift_readback_render::GpuWorldSourceDriftReadbackStateProvider;
pub use drift_readback_render_plugin::GpuWorldSourceDriftReadbackPlugin;
pub use drift_readback_request::{
    GpuWorldSourceDriftReadbackRequestSettings, WORLD_SOURCE_DRIFT_READBACK_ENABLE_ENV,
    build_world_source_drift_readback_inputs, default_world_source_drift_readback_points,
    populate_gpu_world_source_drift_readback_request_once,
};
pub use drift_readback_runtime_acceptance::{
    GpuWorldSourceDriftRuntimeAcceptanceState, WORLD_SOURCE_DRIFT_RUNTIME_ACCEPTANCE_OUT_ENV,
    evaluate_gpu_world_source_drift_runtime_acceptance_once,
};
pub use drift_readback_staging::decode_staged_gpu_world_source_drift_bytes;
pub use height_field::base_surface_height;
pub use island_shape::{IslandMaskSample, IslandShapeConfig, sample_island_mask};
pub use splat::{BiomeSplatSample, MaterialLayerId, sample_biome_splat};
pub use terrain_bridge::{ProceduralWorldSourceTerrainBridge, WorldSourceTerrainBridge};
pub use terrain_source_config::{
    TERRAIN_SOURCE_CONFIG_PATH, TerrainSourceConfig, TerrainSourceMode,
};
pub use terrain_source_diagnostics::{
    TerrainSourceRuntimePath, TerrainSourceSelectionReason, TerrainSourceStartupReport,
    terrain_source_startup_report,
};
pub use world_source::{
    ProceduralWorldSource, TerrainFieldConfig, WORLD_SOURCE_CONFIG_PATH, WorldSource,
    WorldSourceBounds, WorldSourceMetadata,
};
pub use azgaar::{
    AZGAAR_MACRO_SOURCE_KIND, AzgaarImportConfig, AzgaarImportOptions, AzgaarImportedWorld,
    AzgaarMacroWorldGenerator, AzgaarMacroWorldSource, AzgaarWorldSource, AzgaarWorldSourceOptions,
    import_azgaar_full_json, is_azgaar_full_json,
};
