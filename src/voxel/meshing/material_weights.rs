use super::{
    material_weight_index, terrain_meshing_material_at, terrain_meshing_material_in_chunk,
    terrain_meshing_voxel_at, terrain_meshing_voxel_in_chunk,
};
use crate::voxel::chunk::Chunk;
use crate::voxel::types::VoxelType;
use crate::voxel::world::VoxelWorld;
use bevy::prelude::{IVec3, UVec3, Vec3};

/// Computes material weights for a vertex based on neighboring voxels.
pub(crate) fn compute_vertex_material_weights(
    local_pos: Vec3,
    chunk: &Chunk,
    world: &VoxelWorld,
    chunk_origin: IVec3,
) -> [f32; 4] {
    let mut weights = [0.0f32; 4];
    let mut total_weight = 0.0;

    let base_x = local_pos.x.floor() as i32;
    let base_y = local_pos.y.floor() as i32;
    let base_z = local_pos.z.floor() as i32;

    for dz in 0..2 {
        for dy in 0..2 {
            for dx in 0..2 {
                let lx = base_x + dx;
                let ly = base_y + dy;
                let lz = base_z + dz;

                let (voxel, material_id) =
                    if lx >= 0 && lx < 16 && ly >= 0 && ly < 16 && lz >= 0 && lz < 16 {
                        let local = UVec3::new(lx as u32, ly as u32, lz as u32);
                        let voxel = terrain_meshing_voxel_in_chunk(chunk, world, local);
                        (
                            voxel,
                            terrain_meshing_material_in_chunk(chunk, world, local, voxel),
                        )
                    } else {
                        let wx = chunk_origin.x + lx;
                        let wy = chunk_origin.y + ly;
                        let wz = chunk_origin.z + lz;
                        let world_pos = IVec3::new(wx, wy, wz);
                        let voxel = terrain_meshing_voxel_at(world, world_pos);
                        (voxel, terrain_meshing_material_at(world, world_pos, voxel))
                    };

                if voxel != VoxelType::Air && voxel != VoxelType::Water {
                    let mat_idx = material_weight_index(material_id, voxel);
                    weights[mat_idx] += 1.0;
                    total_weight += 1.0;
                }
            }
        }
    }

    if total_weight > 0.0 {
        [
            weights[0] / total_weight,
            weights[1] / total_weight,
            weights[2] / total_weight,
            weights[3] / total_weight,
        ]
    } else {
        [0.0, 0.0, 0.0, 1.0]
    }
}
