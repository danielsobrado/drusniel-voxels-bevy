pub mod config;
pub mod noise;
pub mod sdf;
pub mod world_shape;
pub mod world_shape_placement;

pub use config::TerrainConfig;
pub use noise::{fbm, ridged_fbm, sample_terrain_height};
pub use sdf::sample_terrain_sdf;
pub use world_shape::{
    BiomeHint, CoastSurfaceClass, OceanClass, WorldShapeConfig, WorldShapeSample,
    WorldShapeSampler,
};
pub use world_shape_placement::{
    can_place, placement_rejection, PlacementKind, PlacementRejectReason,
};
