//! Derived visual hydrology data for future water rendering.
//!
//! Voxel water remains authoritative. This module samples terrain generation
//! metadata into render-oriented arrays and does not write voxel state.

pub mod builder;
pub mod config;
pub mod debug_dump;
pub mod field;
pub mod sampling;

pub use builder::VisualHydrologyBuilder;
pub use config::VisualHydrologyConfig;
pub use debug_dump::write_visual_hydrology_debug_dump;
pub use field::{VisualHydrologyField, VisualHydrologyMetadata};
