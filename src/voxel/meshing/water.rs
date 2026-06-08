use super::{
    Face, GreedyQuad, MeshData, WaterAirExposureMode, WaterExposureCache, WaterMeshingStats,
    add_greedy_water_face_world, build_water_face_mask, greedy_mesh_slice,
};
#[cfg(test)]
use super::{PaddedChunkShape, water_meshing_voxel_at, water_meshing_voxel_in_chunk};
use crate::constants::CHUNK_SIZE;
use crate::voxel::chunk::Chunk;
#[cfg(test)]
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::VoxelWorld;
#[cfg(test)]
use bevy::prelude::UVec3;
use bevy::prelude::{IVec3, Vec3};
#[cfg(test)]
use ndshape::ConstShape;

/// Get voxel type at padded coordinates for water SDF generation.
#[cfg(test)]
pub(super) fn get_voxel_for_water_sdf(
    chunk: &Chunk,
    world: &VoxelWorld,
    chunk_origin: IVec3,
    px: i32,
    py: i32,
    pz: i32,
) -> VoxelType {
    let world_pos = chunk_origin + IVec3::new(px - 1, py - 1, pz - 1);

    if px >= 1 && px <= 16 && py >= 1 && py <= 16 && pz >= 1 && pz <= 16 {
        water_meshing_voxel_in_chunk(
            chunk,
            world,
            UVec3::new((px - 1) as u32, (py - 1) as u32, (pz - 1) as u32),
        )
    } else {
        water_meshing_voxel_at(world, world_pos)
    }
}

#[cfg(test)]
pub(super) fn water_sdf_value_for_voxel(
    voxel: VoxelType,
    world: &VoxelWorld,
    world_pos: IVec3,
    exposure: &mut WaterExposureCache,
    stats: &mut WaterMeshingStats,
) -> f32 {
    if voxel.is_liquid() || voxel.is_solid() {
        return -1.0;
    }
    if voxel != VoxelType::Air {
        return -1.0;
    }

    if exposure.air_exposed(world, world_pos, stats) {
        1.0
    } else {
        -1.0
    }
}

/// Generate an SDF array for water surfaces.
/// Only generates surfaces at water/air boundaries.
/// Solid voxels and sealed air are treated as inside so hidden water surfaces are not generated.
#[cfg(test)]
pub(super) fn generate_water_sdf(
    chunk: &Chunk,
    world: &VoxelWorld,
    water_exposure_mode: WaterAirExposureMode,
) -> [f32; 5832] {
    let mut sdf = [1.0f32; PaddedChunkShape::USIZE];
    let chunk_pos = chunk.position();
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
    let mut exposure = WaterExposureCache::new(water_exposure_mode);
    let mut stats = WaterMeshingStats::default();

    for i in 0..PaddedChunkShape::USIZE {
        let [px, py, pz] = PaddedChunkShape::delinearize(i as u32);
        let px = px as i32;
        let py = py as i32;
        let pz = pz as i32;

        let voxel = get_voxel_for_water_sdf(chunk, world, chunk_origin, px, py, pz);
        let world_pos = chunk_origin + IVec3::new(px - 1, py - 1, pz - 1);

        sdf[i] = water_sdf_value_for_voxel(voxel, world, world_pos, &mut exposure, &mut stats);
    }

    sdf
}

/// Generates water mesh using blocky faces for clean edges.
/// Uses exact voxel boundaries to prevent interpolation artifacts.
/// Generate water mesh for a chunk (shared by Surface Nets and MC paths).
pub fn generate_water_mesh(
    chunk: &Chunk,
    world: &VoxelWorld,
    _chunk_center: Vec3,
    chunk_origin: IVec3,
    water_exposure_mode: WaterAirExposureMode,
) -> (MeshData, WaterMeshingStats) {
    let mut water_mesh = MeshData::with_capacity(256, 384);
    let faces = [
        Face::Top,
        Face::Bottom,
        Face::North,
        Face::South,
        Face::East,
        Face::West,
    ];

    // Greedy meshing for water — merges ocean surfaces into large quads
    let mut water_quads: Vec<GreedyQuad> = Vec::with_capacity(32);
    let mut water_exposure = WaterExposureCache::new(water_exposure_mode);
    let mut water_stats = WaterMeshingStats::default();
    for face in faces {
        for depth in 0..CHUNK_SIZE as u32 {
            let mut mask = build_water_face_mask(
                chunk,
                world,
                face,
                depth,
                &mut water_exposure,
                &mut water_stats,
            );
            greedy_mesh_slice(&mut mask, depth, &mut water_quads);
            for quad in &water_quads {
                add_greedy_water_face_world(&mut water_mesh, quad, face, chunk_origin, world);
            }
        }
    }

    (water_mesh, water_stats)
}
