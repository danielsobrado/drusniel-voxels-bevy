use super::{
    Face, GreedyQuad, MeshData, PaddedChunkShape, WaterAirExposureMode, WaterExposureCache,
    WaterMeshingStats, add_greedy_water_face_world, build_water_face_mask,
    get_normalized_normal, greedy_mesh_slice, sanitize_position, scale_vertex_from_center,
    water_meshing_voxel_at, water_meshing_voxel_in_chunk,
};
use crate::constants::{CHUNK_SIZE, VOXEL_SIZE};
use crate::voxel::chunk::Chunk;
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::VoxelWorld;
use bevy::prelude::{IVec3, UVec3, Vec3};
use fast_surface_nets::{SurfaceNetsBuffer, surface_nets};
use ndshape::ConstShape;

/// Get voxel type at padded coordinates for water SDF generation.
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

/// Old Surface Nets water mesh generation (kept for reference).
#[allow(dead_code)]
pub(super) fn generate_water_mesh_surface_nets(
    chunk: &Chunk,
    world: &VoxelWorld,
    chunk_center: Vec3,
    chunk_origin: IVec3,
) -> MeshData {
    let mut water_mesh = MeshData::with_capacity(256, 384);

    let water_sdf = generate_water_sdf(chunk, world, WaterAirExposureMode::default());
    let mut water_buffer = SurfaceNetsBuffer::default();
    surface_nets(
        &water_sdf,
        &PaddedChunkShape {},
        [0; 3],
        [17; 3],
        &mut water_buffer,
    );

    if water_buffer.positions.is_empty() || water_buffer.indices.is_empty() {
        return water_mesh;
    }

    for tri_idx in (0..water_buffer.indices.len()).step_by(3) {
        let i0 = water_buffer.indices[tri_idx] as usize;
        let i1 = water_buffer.indices[tri_idx + 1] as usize;
        let i2 = water_buffer.indices[tri_idx + 2] as usize;

        let p0 = sanitize_position(water_buffer.positions.get(i0).copied().unwrap_or([0.0; 3]));
        let p1 = sanitize_position(water_buffer.positions.get(i1).copied().unwrap_or([0.0; 3]));
        let p2 = sanitize_position(water_buffer.positions.get(i2).copied().unwrap_or([0.0; 3]));

        let local0 = Vec3::new(p0[0] - 1.0, p0[1] - 1.0, p0[2] - 1.0);
        let local1 = Vec3::new(p1[0] - 1.0, p1[1] - 1.0, p1[2] - 1.0);
        let local2 = Vec3::new(p2[0] - 1.0, p2[1] - 1.0, p2[2] - 1.0);

        // Calculate averaged normal for the triangle
        let n0 = get_normalized_normal(&water_buffer.normals, i0);
        let n1 = get_normalized_normal(&water_buffer.normals, i1);
        let n2 = get_normalized_normal(&water_buffer.normals, i2);
        let avg = [
            (n0[0] + n1[0] + n2[0]) / 3.0,
            (n0[1] + n1[1] + n2[1]) / 3.0,
            (n0[2] + n1[2] + n2[2]) / 3.0,
        ];
        let len = (avg[0].powi(2) + avg[1].powi(2) + avg[2].powi(2)).sqrt();
        let final_normal = if len > 0.001 {
            [avg[0] / len, avg[1] / len, avg[2] / len]
        } else {
            [0.0, 1.0, 0.0]
        };

        let start_idx = water_mesh.positions.len() as u32;

        let offset = Vec3::Y * crate::constants::WATER_SURFACE_OFFSET;
        water_mesh
            .positions
            .push(scale_vertex_from_center(local0 + offset, chunk_center));
        water_mesh
            .positions
            .push(scale_vertex_from_center(local1 + offset, chunk_center));
        water_mesh
            .positions
            .push(scale_vertex_from_center(local2 + offset, chunk_center));

        water_mesh.normals.push(final_normal);
        water_mesh.normals.push(final_normal);
        water_mesh.normals.push(final_normal);

        // World-space UVs for water to keep waves continuous across chunks.
        let get_uv = |p: Vec3| -> [f32; 2] {
            let world_pos = chunk_origin.as_vec3() + p * VOXEL_SIZE;
            [world_pos.x, world_pos.z]
        };
        water_mesh.uvs.push(get_uv(local0));
        water_mesh.uvs.push(get_uv(local1));
        water_mesh.uvs.push(get_uv(local2));

        water_mesh.colors.push([1.0, 1.0, 1.0, 1.0]);
        water_mesh.colors.push([1.0, 1.0, 1.0, 1.0]);
        water_mesh.colors.push([1.0, 1.0, 1.0, 1.0]);

        water_mesh.indices.push(start_idx);
        water_mesh.indices.push(start_idx + 1);
        water_mesh.indices.push(start_idx + 2);
    }

    water_mesh
}
