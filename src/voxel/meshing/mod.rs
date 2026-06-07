//! Mesh generation for voxel chunks.
//!
//! This module provides two meshing modes:
//! - **Blocky**: Greedy meshing that combines adjacent faces of the same material
//! - **Surface Nets**: Smooth terrain meshing using the Surface Nets algorithm
//!
//! Both modes support ambient occlusion and proper chunk boundary handling.

use crate::constants::{
    ATLAS_COLUMNS,
    ATLAS_ROWS,
    CHUNK_BOUNDARY_SCALE,
    CHUNK_SIZE,
    CHUNK_SIZE_I32,
    LOD0_GRID_VOLUME,
    // LOD grid configurations
    LOD0_PADDED_SIZE,
    LOD0_STEP_SIZE,
    LOD1_GRID_VOLUME,
    LOD1_PADDED_SIZE,
    LOD1_STEP_SIZE,
    LOD2_GRID_VOLUME,
    LOD2_PADDED_SIZE,
    LOD2_STEP_SIZE,
    LOD3_GRID_VOLUME,
    LOD3_PADDED_SIZE,
    LOD3_STEP_SIZE,
    PADDED_CHUNK_SIZE_U32,
    UV_PADDING,
    VOXEL_SIZE,
};
use crate::rendering::ao_config::BakedAoConfig;
use crate::rendering::triplanar_material::TerrainMaterialQuality;
use crate::voxel::baked_ao::compute_surface_nets_ao;
use crate::voxel::chunk::{Chunk, LodLevel};
use crate::voxel::materials::MaterialId;
use crate::voxel::meshing_lod::append_morph_targets;
use crate::voxel::meshing_types::{ATTRIBUTE_MORPH_TARGET, TerrainMorphConfig};
use crate::voxel::skirt::{
    ChunkFace, NeighborLods, SkirtConfig, SkirtGenerationStats, extract_boundary_edges,
    generate_skirts_with_sealed_faces,
};
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::{VoxelSample, VoxelWorld};
use bevy::asset::RenderAssetUsages;
use bevy::ecs::query::QueryItem;
use bevy::prelude::*;
use bevy::render::extract_component::ExtractComponent;
use bevy_mesh::{Indices, PrimitiveTopology};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::OnceLock;

// Surface nets imports for smooth meshing
use fast_surface_nets::{SurfaceNetsBuffer, surface_nets};
use ndshape::{ConstShape, ConstShape3u32};

const WATER_SHORELINE_EXTENSION: f32 = VOXEL_SIZE * 0.18;
const WATER_EDGE_SURFACE_SUPPRESSION_MARGIN: i32 = 2;

mod blocky;
mod data;
mod lod_seam;
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
#[cfg(test)]
pub(crate) use lod_seam::snap_column_for_face;
pub(crate) use lod_seam::{
    coarse_lattice_y_face_target, scale_vertex_from_center, terrain_morph_config,
    transition_target_lod, xz_face_coarse_target_local,
};
pub use pipeline::*;
pub use sdf::{LodMeshConfig, lod_delta_gt_one_face_mask, mesher_smoothed_sdf_at_world_pos};
pub(crate) use sdf::{
    coarse_lod_iso_height_for_column, count_missing_in_bounds_boundary_neighbors,
    empty_chunk_has_surface_nets_boundary_surface, neighbor_lod_for_face,
};
pub use surface_nets::{
    generate_chunk_mesh_surface_nets, generate_chunk_mesh_surface_nets_lod1,
    generate_chunk_mesh_surface_nets_lod2, generate_chunk_mesh_surface_nets_lod3,
};
pub use water::generate_water_mesh;

use blocky::*;
use lod_seam::*;
use material_weights::*;
use sdf::*;
#[allow(unused_imports)]
use water::*;
