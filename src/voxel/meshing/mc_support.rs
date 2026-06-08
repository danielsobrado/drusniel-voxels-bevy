#![cfg_attr(not(feature = "mc_transvoxel"), allow(dead_code))]
//! Shared SDF sampling helpers for the MC + Transvoxel spike.
use super::{
    compute_vertex_material_weights, scale_vertex_from_center, sdf_gradient_normal_at_local,
};
use crate::constants::{
    LOD0_PADDED_SIZE, LOD1_GRID_VOLUME, LOD1_PADDED_SIZE, LOD1_STEP_SIZE, LOD2_GRID_VOLUME,
    LOD2_PADDED_SIZE, LOD2_STEP_SIZE, LOD3_GRID_VOLUME, LOD3_PADDED_SIZE, LOD3_STEP_SIZE,
};
use crate::voxel::world::VoxelWorld;
use bevy::prelude::{IVec3, Vec3};
use ndshape::ConstShape;

pub fn build_mc_sdf_values(
    chunk: &crate::voxel::chunk::Chunk,
    world: &VoxelWorld,
    my_lod: crate::voxel::chunk::LodLevel,
    neighbor_lods: &crate::voxel::skirt::NeighborLods,
) -> (usize, Vec<f32>, i32) {
    use crate::voxel::chunk::LodLevel;
    let step = my_lod.step_size() as i32;
    match my_lod {
        LodLevel::Lod0 => {
            let sdf = super::generate_sdf_with_transition_mode(
                chunk,
                world,
                my_lod,
                neighbor_lods,
                super::SMOOTH_TERRAIN_SDF_LOD0,
                super::BaseSdfTransitionMode::Coarsen,
            );
            (LOD0_PADDED_SIZE as usize, sdf.to_vec(), step)
        }
        LodLevel::Lod1 => {
            let sdf = super::generate_low_lod_sdf_with_smoothing::<{ LOD1_GRID_VOLUME }>(
                chunk,
                world,
                LOD1_PADDED_SIZE,
                LOD1_STEP_SIZE as i32,
                super::LodShape1::linearize,
                LodLevel::Lod1,
                neighbor_lods,
                super::coarse_terrain_sdf_smooth_enabled(),
            );
            (LOD1_PADDED_SIZE as usize, sdf.to_vec(), step)
        }
        LodLevel::Lod2 => {
            let sdf = super::generate_low_lod_sdf_with_smoothing::<{ LOD2_GRID_VOLUME }>(
                chunk,
                world,
                LOD2_PADDED_SIZE,
                LOD2_STEP_SIZE as i32,
                super::LodShape2::linearize,
                LodLevel::Lod2,
                neighbor_lods,
                super::coarse_terrain_sdf_smooth_enabled(),
            );
            (LOD2_PADDED_SIZE as usize, sdf.to_vec(), step)
        }
        LodLevel::Lod3 => {
            let sdf = super::generate_low_lod_sdf_with_smoothing::<{ LOD3_GRID_VOLUME }>(
                chunk,
                world,
                LOD3_PADDED_SIZE,
                LOD3_STEP_SIZE as i32,
                super::LodShape3::linearize,
                LodLevel::Lod3,
                neighbor_lods,
                super::coarse_terrain_sdf_smooth_enabled(),
            );
            (LOD3_PADDED_SIZE as usize, sdf.to_vec(), step)
        }
        LodLevel::Culled => (0, Vec::new(), step),
    }
}

pub fn vertex_material_weights(
    local_pos: Vec3,
    chunk: &crate::voxel::chunk::Chunk,
    world: &VoxelWorld,
    chunk_origin: IVec3,
) -> [f32; 4] {
    compute_vertex_material_weights(local_pos, chunk, world, chunk_origin)
}

pub fn scale_vertex(local: Vec3, chunk_center: Vec3) -> [f32; 3] {
    scale_vertex_from_center(local, chunk_center)
}

pub fn gradient_normal(world: &VoxelWorld, chunk_origin: IVec3, local_pos: Vec3) -> [f32; 3] {
    sdf_gradient_normal_at_local(world, chunk_origin, local_pos)
}
