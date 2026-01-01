//! Voxel engine core module.
//!
//! This module provides the core voxel functionality including:
//! - [`chunk`] - Chunk data structure and operations
//! - [`types`] - Voxel type definitions and traits
//! - [`world`] - World coordinate system and chunk management
//! - [`meshing`] - Surface Nets mesh generation for smooth terrain
//! - [`plugin`] - Bevy plugin integration
//! - [`persistence`] - World save/load functionality
//! - [`gravity`] - Voxel gravity simulation
//! - [`skirt`] - LOD boundary skirts for seamless transitions
//! - [`baked_ao`] - Baked ambient occlusion for voxel lighting

pub mod baked_ao;
pub mod chunk;
pub mod gravity;
pub mod meshing;
pub mod persistence;
pub mod plugin;
pub mod skirt;
pub mod types;
pub mod world;
