//! Voxel engine core module.
//!
//! This module provides the core voxel functionality including:
//! - [`chunk`] - Chunk data structure and operations
//! - [`types`] - Voxel type definitions and traits
//! - [`world`] - World coordinate system and chunk management
//! - [`meshing`] - Surface Nets mesh generation for smooth terrain
//! - [`terrain`] - Procedural terrain generation with noise abstractions
//! - [`plugin`] - Bevy plugin integration
//! - [`persistence`] - World save/load functionality
//! - [`gravity`] - Voxel gravity simulation
//! - [`skirt`] - LOD boundary skirts for seamless transitions
//! - [`baked_ao`] - Baked ambient occlusion for voxel lighting
//! - [`visibility`] - Face visibility computation for occlusion culling
//! - [`occlusion`] - Runtime BFS occlusion culling
//! - [`octree`] - Hierarchical octree for frustum culling

pub mod baked_ao;
pub mod chunk;
pub mod enclosure;
pub mod gravity;
pub mod hole_probe;
pub mod materials;
pub mod lod_boundary_strip;
pub mod mc_transvoxel;
pub mod mesh_invalidation;
pub mod meshing;
pub mod meshing_lod;
pub mod meshing_types;
pub mod model_io;
pub mod occlusion;
pub mod octree;
pub mod persistence;
pub mod plugin;
pub mod skirt;
pub mod terrain;
pub mod terrain_debug;
pub mod terrain_iso_band;
pub mod types;
pub mod visibility;
pub mod world;
