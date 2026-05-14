use bevy::prelude::*;

use crate::rendering::naadf::layout::NaadfChunk;
use crate::voxel::types::Voxel;
use crate::voxel::world::VoxelWorld;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NaadfOccupancyMismatch {
    pub local: UVec3,
    pub world_occupied: bool,
    pub naadf_occupied: bool,
}

pub fn compare_chunk_occupancy(
    world: &VoxelWorld,
    naadf_chunk: &NaadfChunk,
    max_mismatches: usize,
) -> Vec<NaadfOccupancyMismatch> {
    let Some(chunk) = world.get_chunk(naadf_chunk.position) else {
        return Vec::new();
    };

    let mut mismatches = Vec::new();
    for (local, voxel) in chunk.iter() {
        let world_occupied = voxel.is_solid();
        let naadf_occupied = naadf_chunk.is_occupied(local);
        if world_occupied != naadf_occupied {
            mismatches.push(NaadfOccupancyMismatch {
                local,
                world_occupied,
                naadf_occupied,
            });
            if mismatches.len() >= max_mismatches {
                break;
            }
        }
    }
    mismatches
}
