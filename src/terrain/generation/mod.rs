pub mod config;
pub mod noise;
pub mod sdf;
pub mod world_shape;
pub mod world_shape_debug;
pub mod world_shape_far_field;
pub mod world_shape_placement;

pub use config::TerrainConfig;
pub use noise::{fbm, ridged_fbm, sample_terrain_height};
pub use sdf::sample_terrain_sdf;
pub use world_shape::{
    BiomeHint, CoastSurfaceClass, OceanClass, WorldShapeConfig, WorldShapeSample, WorldShapeSampler,
};
pub use world_shape_debug::{WorldShapeDebugMode, WorldShapeDebugSample, sample_world_shape_debug};
pub use world_shape_far_field::{
    FarFieldTerrainSample, far_field_is_deep_sea, far_field_is_drawn_as_land,
    sample_far_field_terrain,
};
pub use world_shape_placement::{
    PlacementKind, PlacementRejectReason, can_place, placement_rejection,
};
