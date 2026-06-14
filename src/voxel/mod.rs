//! Voxel engine core module.
//!
//! This module provides the core voxel functionality including:
//! - [`core::chunk`] - Chunk data structure and operations
//! - [`core::types`] - Voxel type definitions and traits
//! - [`core::world`] - World coordinate system and chunk management
//! - [`meshing`] - Surface Nets mesh generation for smooth terrain
//! - [`terrain`] - Procedural terrain generation with noise abstractions
//! - [`plugin`] - Bevy plugin integration
//! - [`io::persistence`] - World save/load functionality
//! - [`simulation::gravity`] - Voxel gravity simulation
//! - [`lod::skirt`] - chunk face and neighbor LOD helper types
//! - [`meshing::baked_ao`] - Baked ambient occlusion for voxel lighting
//! - [`culling::visibility`] - Face visibility computation for occlusion culling
//! - [`culling::occlusion`] - Runtime BFS occlusion culling
//! - [`culling::octree`] - Hierarchical octree for frustum culling

pub mod core;
pub mod culling;
pub mod diagnostics;
pub mod io;
pub mod lod;
pub mod mc_transvoxel;
pub mod meshing;
pub mod pages;
pub mod plugin;
pub(crate) mod runtime;
pub mod simulation;
pub mod terrain;

pub mod baked_ao {
    pub use super::meshing::baked_ao::*;
}

pub mod chunk {
    pub use super::core::chunk::*;
}

pub mod enclosure {
    pub use super::culling::enclosure::*;
}

pub mod gravity {
    pub use super::simulation::gravity::*;
}

pub mod materials {
    pub use super::core::materials::*;
}

pub mod mesh_commit {
    pub(crate) use super::meshing::commit::*;
}

pub mod mesh_invalidation {
    pub use super::meshing::invalidation::*;
}

pub mod occlusion {
    pub use super::culling::occlusion::*;
}

pub mod octree {
    pub use super::culling::octree::*;
}

pub mod skirt {
    pub use super::lod::skirt::*;
}

pub mod types {
    pub use super::core::types::*;
}

pub mod visibility {
    pub use super::culling::visibility::*;
}

pub mod world {
    pub use super::core::world::*;
}

pub mod hole_probe {
    pub use super::diagnostics::hole_probe::*;
}

pub mod model_io {
    pub use super::io::model_io::*;
}

pub mod persistence {
    pub use super::io::persistence::*;
}

pub mod terrain_debug {
    pub use super::diagnostics::terrain_debug::*;
}

pub mod terrain_iso_band {
    pub use super::diagnostics::terrain_iso_band::*;
}
