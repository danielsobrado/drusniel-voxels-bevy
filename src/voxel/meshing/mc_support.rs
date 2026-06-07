#![cfg_attr(not(feature = "mc_transvoxel"), allow(dead_code))]
//! Shared SDF sampling helpers for the MC + Transvoxel spike.
use super::{
    coarse_aligned_lod_sample_base_with_stride, compute_vertex_material_weights,
    scale_vertex_from_center, sdf_gradient_normal_at_local, smoothed_terrain_sdf_at_world_pos,
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
            (super::LOD0_PADDED_SIZE as usize, sdf.to_vec(), step)
        }
        LodLevel::Lod1 => {
            let sdf = super::generate_low_lod_sdf_with_smoothing::<{ super::LOD1_GRID_VOLUME }>(
                chunk,
                world,
                super::LOD1_PADDED_SIZE,
                super::LOD1_STEP_SIZE as i32,
                super::LodShape1::linearize,
                LodLevel::Lod1,
                neighbor_lods,
                super::coarse_terrain_sdf_smooth_enabled(),
            );
            (super::LOD1_PADDED_SIZE as usize, sdf.to_vec(), step)
        }
        LodLevel::Lod2 => {
            let sdf = super::generate_low_lod_sdf_with_smoothing::<{ super::LOD2_GRID_VOLUME }>(
                chunk,
                world,
                super::LOD2_PADDED_SIZE,
                super::LOD2_STEP_SIZE as i32,
                super::LodShape2::linearize,
                LodLevel::Lod2,
                neighbor_lods,
                super::coarse_terrain_sdf_smooth_enabled(),
            );
            (super::LOD2_PADDED_SIZE as usize, sdf.to_vec(), step)
        }
        LodLevel::Lod3 => {
            let sdf = super::generate_low_lod_sdf_with_smoothing::<{ super::LOD3_GRID_VOLUME }>(
                chunk,
                world,
                super::LOD3_PADDED_SIZE,
                super::LOD3_STEP_SIZE as i32,
                super::LodShape3::linearize,
                LodLevel::Lod3,
                neighbor_lods,
                super::coarse_terrain_sdf_smooth_enabled(),
            );
            (super::LOD3_PADDED_SIZE as usize, sdf.to_vec(), step)
        }
        LodLevel::Culled => (0, Vec::new(), step),
    }
}

#[allow(dead_code)]
pub fn sample_smoothed_sdf_at_padded(
    world: &VoxelWorld,
    chunk_origin: IVec3,
    px: u32,
    py: u32,
    pz: u32,
    step: i32,
) -> f32 {
    let base_world_pos =
        coarse_aligned_lod_sample_base_with_stride(chunk_origin, px, py, pz, 1, step);
    smoothed_terrain_sdf_at_world_pos(world, base_world_pos)
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
