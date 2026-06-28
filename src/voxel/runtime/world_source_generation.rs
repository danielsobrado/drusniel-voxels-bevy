use bevy::prelude::{IVec3, UVec3};

use crate::constants::{CHUNK_SIZE, CHUNK_SIZE_I32, CHUNK_VOLUME};
use crate::voxel::chunk::Chunk;
use crate::voxel::types::VoxelType;
use crate::world::source::ProceduralWorldSourceTerrainBridge;

pub(crate) fn fill_world_source_chunk_voxels(
    chunk_pos: IVec3,
    bridge: &ProceduralWorldSourceTerrainBridge,
) -> [VoxelType; CHUNK_VOLUME] {
    let chunk_world_x = chunk_pos.x * CHUNK_SIZE_I32;
    let chunk_world_y = chunk_pos.y * CHUNK_SIZE_I32;
    let chunk_world_z = chunk_pos.z * CHUNK_SIZE_I32;
    let mut voxels = [VoxelType::Air; CHUNK_VOLUME];

    for z in 0..CHUNK_SIZE {
        for y in 0..CHUNK_SIZE {
            for x in 0..CHUNK_SIZE {
                let world_x = chunk_world_x + x as i32;
                let world_y = chunk_world_y + y as i32;
                let world_z = chunk_world_z + z as i32;
                let local = UVec3::new(x as u32, y as u32, z as u32);
                voxels[Chunk::index(local.x as usize, local.y as usize, local.z as usize)] =
                    bridge.get_voxel(world_x, world_y, world_z);
            }
        }
    }

    voxels
}
