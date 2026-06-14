//! Mesh generation for voxel chunks.
//!
//! This module provides two meshing modes:
//! - **Blocky**: Greedy meshing that combines adjacent faces of the same material
//! - **Surface Nets**: Smooth terrain meshing using the Surface Nets algorithm
//!
//! Both modes support ambient occlusion and proper chunk boundary handling.

use crate::constants::VOXEL_SIZE;

#[cfg(test)]
#[allow(unused_imports)]
use crate::constants::{
    ATLAS_COLUMNS, ATLAS_ROWS, CHUNK_BOUNDARY_SCALE, CHUNK_SIZE, CHUNK_SIZE_I32, LOD0_GRID_VOLUME,
    LOD0_PADDED_SIZE, LOD0_STEP_SIZE, LOD1_GRID_VOLUME, LOD1_PADDED_SIZE, LOD1_STEP_SIZE,
    LOD2_GRID_VOLUME, LOD2_PADDED_SIZE, LOD2_STEP_SIZE, LOD3_GRID_VOLUME, LOD3_PADDED_SIZE,
    LOD3_STEP_SIZE, PADDED_CHUNK_SIZE_U32, UV_PADDING,
};
#[cfg(test)]
#[allow(unused_imports)]
use crate::rendering::ao_config::BakedAoConfig;
#[cfg(test)]
#[allow(unused_imports)]
use crate::rendering::triplanar_material::TerrainMaterialQuality;
#[cfg(test)]
#[allow(unused_imports)]
use crate::voxel::baked_ao::compute_surface_nets_ao;
#[cfg(test)]
#[allow(unused_imports)]
use crate::voxel::chunk::{Chunk, LodLevel};
#[cfg(test)]
#[allow(unused_imports)]
use crate::voxel::materials::MaterialId;
#[cfg(test)]
#[allow(unused_imports)]
use crate::voxel::skirt::{ChunkFace, NeighborLods};
#[cfg(test)]
#[allow(unused_imports)]
use crate::voxel::types::{Voxel, VoxelType};
#[cfg(test)]
#[allow(unused_imports)]
use crate::voxel::world::{VoxelSample, VoxelWorld};
#[cfg(test)]
#[allow(unused_imports)]
use bevy::asset::RenderAssetUsages;
#[cfg(test)]
#[allow(unused_imports)]
use bevy::ecs::query::QueryItem;
#[cfg(test)]
#[allow(unused_imports)]
use bevy::prelude::*;
#[cfg(test)]
#[allow(unused_imports)]
use bevy::render::extract_component::ExtractComponent;
#[cfg(test)]
#[allow(unused_imports)]
use bevy_mesh::{Indices, PrimitiveTopology};
#[cfg(test)]
#[allow(unused_imports)]
use fast_surface_nets::{SurfaceNetsBuffer, surface_nets};
#[cfg(test)]
#[allow(unused_imports)]
use ndshape::{ConstShape, ConstShape3u32};
#[cfg(test)]
#[allow(unused_imports)]
use std::collections::{HashMap, HashSet, VecDeque};
#[cfg(test)]
#[allow(unused_imports)]
use std::sync::OnceLock;

const WATER_SHORELINE_EXTENSION: f32 = VOXEL_SIZE * 0.18;
const WATER_EDGE_SURFACE_SUPPRESSION_MARGIN: i32 = 2;

pub mod baked_ao;
mod blocky;
pub mod commit;
mod data;
pub mod invalidation;
mod material_weights;
pub(crate) mod mc_support;
mod pipeline;
mod sdf;
mod surface_nets;
#[cfg(test)]
mod tests;
mod water;

pub use blocky::get_blocky_material_index;
pub use data::*;
pub use pipeline::*;
pub use sdf::{LodMeshConfig, lod_delta_gt_one_face_mask, mesher_smoothed_sdf_at_world_pos};
pub(crate) use sdf::{
    count_missing_in_bounds_boundary_neighbors, empty_chunk_has_surface_nets_boundary_surface,
};
pub use surface_nets::generate_chunk_mesh_surface_nets;
pub(crate) use surface_nets::scale_vertex_from_center;
pub use water::generate_water_mesh;

use blocky::*;
use material_weights::*;
use sdf::*;
#[allow(unused_imports)]
use water::*;
