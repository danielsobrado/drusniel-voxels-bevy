use bevy::prelude::*;

use crate::constants::CHUNK_VOLUME;
use crate::rendering::naadf::layout::{
    BLOCKS_PER_CHUNK, DirectionalBounds, NaadfBlock, NaadfChunk, NaadfNodeState, PackedNaadfNode,
    VOXELS_PER_BLOCK, VOXELS_PER_BLOCK_AXIS, block_coord_for_voxel, block_index_in_chunk,
    local_coord_in_block, voxel_index_in_block, voxel_index_in_chunk,
};
use crate::voxel::chunk::Chunk;
use crate::voxel::types::{Voxel, VoxelType};

#[derive(Clone, Copy, Debug)]
pub struct NaadfBuildOptions {
    pub water_is_opaque: bool,
}

impl Default for NaadfBuildOptions {
    fn default() -> Self {
        Self {
            water_is_opaque: false,
        }
    }
}

pub fn build_naadf_chunk(chunk: &Chunk, options: NaadfBuildOptions) -> NaadfChunk {
    let mut occupancy = [false; CHUNK_VOLUME];
    let mut material_ids = [0; CHUNK_VOLUME];
    let mut occupied_count = 0usize;
    let mut first_material = 0u16;
    let mut uniform_material = true;

    for (local, voxel) in chunk.iter() {
        let index = voxel_index_in_chunk(local);
        let material_id = material_id_for_voxel(voxel, options);
        let occupied = material_id != 0;
        occupancy[index] = occupied;
        material_ids[index] = material_id;
        if occupied {
            occupied_count += 1;
            if first_material == 0 {
                first_material = material_id;
            } else if first_material != material_id {
                uniform_material = false;
            }
        }
    }

    let node = if occupied_count == 0 {
        PackedNaadfNode::new(NaadfNodeState::UniformEmpty, 0)
    } else if occupied_count == CHUNK_VOLUME && uniform_material {
        PackedNaadfNode::new(NaadfNodeState::UniformFull, first_material as u32)
    } else {
        PackedNaadfNode::new(NaadfNodeState::Children, 0)
    };

    let mut blocks = vec![NaadfBlock::default(); BLOCKS_PER_CHUNK as usize];
    for block_z in 0..4 {
        for block_y in 0..4 {
            for block_x in 0..4 {
                let block_coord = UVec3::new(block_x, block_y, block_z);
                let block_index = block_index_in_chunk(block_coord);
                blocks[block_index] = build_block(block_coord, &occupancy, &material_ids);
            }
        }
    }

    NaadfChunk {
        position: chunk.position(),
        node,
        blocks,
        occupancy,
        material_ids,
    }
}

pub fn material_id_for_voxel(voxel: VoxelType, options: NaadfBuildOptions) -> u16 {
    if voxel == VoxelType::Water && !options.water_is_opaque {
        return 0;
    }
    if voxel.is_solid() || (voxel == VoxelType::Water && options.water_is_opaque) {
        voxel as u16
    } else {
        0
    }
}

fn build_block(
    block_coord: UVec3,
    chunk_occupancy: &[bool; CHUNK_VOLUME],
    chunk_material_ids: &[u16; CHUNK_VOLUME],
) -> NaadfBlock {
    let mut block = NaadfBlock::default();
    let mut occupied = 0usize;
    let mut first_material = 0u16;
    let mut uniform_material = true;

    for z in 0..VOXELS_PER_BLOCK_AXIS {
        for y in 0..VOXELS_PER_BLOCK_AXIS {
            for x in 0..VOXELS_PER_BLOCK_AXIS {
                let block_local = UVec3::new(x, y, z);
                let chunk_local = block_coord * VOXELS_PER_BLOCK_AXIS + block_local;
                let chunk_index = voxel_index_in_chunk(chunk_local);
                let block_index = voxel_index_in_block(block_local);
                let material_id = chunk_material_ids[chunk_index];
                block.material_ids[block_index] = material_id;
                if chunk_occupancy[chunk_index] {
                    block.occupancy_mask |= 1u64 << block_index;
                    occupied += 1;
                    if first_material == 0 {
                        first_material = material_id;
                    } else if first_material != material_id {
                        uniform_material = false;
                    }
                }
            }
        }
    }

    block.node = if occupied == 0 {
        PackedNaadfNode::new(NaadfNodeState::UniformEmpty, 0)
    } else if occupied == VOXELS_PER_BLOCK as usize && uniform_material {
        PackedNaadfNode::new(NaadfNodeState::UniformFull, first_material as u32)
    } else {
        PackedNaadfNode::new(NaadfNodeState::Children, 0)
    };
    block.bounds = compute_directional_bounds(block.occupancy_mask);
    block
}

pub fn compute_directional_bounds(occupancy_mask: u64) -> DirectionalBounds {
    if occupancy_mask == 0 {
        return DirectionalBounds::empty_block();
    }
    if occupancy_mask == u64::MAX >> (64 - VOXELS_PER_BLOCK) {
        return DirectionalBounds::full_block();
    }

    let mut min = UVec3::splat(VOXELS_PER_BLOCK_AXIS);
    let mut max = UVec3::ZERO;
    for z in 0..VOXELS_PER_BLOCK_AXIS {
        for y in 0..VOXELS_PER_BLOCK_AXIS {
            for x in 0..VOXELS_PER_BLOCK_AXIS {
                let local = UVec3::new(x, y, z);
                let index = voxel_index_in_block(local);
                if occupancy_mask & (1u64 << index) == 0 {
                    continue;
                }
                min = min.min(local);
                max = max.max(local);
            }
        }
    }

    DirectionalBounds {
        neg_x: min.x as u8,
        pos_x: (VOXELS_PER_BLOCK_AXIS - 1 - max.x) as u8,
        neg_y: min.y as u8,
        pos_y: (VOXELS_PER_BLOCK_AXIS - 1 - max.y) as u8,
        neg_z: min.z as u8,
        pos_z: (VOXELS_PER_BLOCK_AXIS - 1 - max.z) as u8,
    }
}

pub fn occupancy_mask_for_chunk_voxel(local: UVec3) -> (usize, u64) {
    let block_coord = block_coord_for_voxel(local);
    let block_local = local_coord_in_block(local);
    (
        block_index_in_chunk(block_coord),
        1u64 << voxel_index_in_block(block_local),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_chunk_builds_uniform_empty() {
        let chunk = Chunk::new(IVec3::ZERO);
        let naadf = build_naadf_chunk(&chunk, NaadfBuildOptions::default());
        assert_eq!(naadf.node.state(), NaadfNodeState::UniformEmpty);
        assert!(naadf.occupancy.iter().all(|occupied| !occupied));
    }

    #[test]
    fn water_is_not_opaque_by_default() {
        let mut chunk = Chunk::new(IVec3::ZERO);
        chunk.set(UVec3::new(1, 1, 1), VoxelType::Water);
        let naadf = build_naadf_chunk(&chunk, NaadfBuildOptions::default());
        assert_eq!(naadf.node.state(), NaadfNodeState::UniformEmpty);
    }

    #[test]
    fn single_origin_voxel_bounds_match_directional_distances() {
        let mask = 1u64 << voxel_index_in_block(UVec3::ZERO);
        assert_eq!(
            compute_directional_bounds(mask),
            DirectionalBounds {
                neg_x: 0,
                pos_x: 3,
                neg_y: 0,
                pos_y: 3,
                neg_z: 0,
                pos_z: 3,
            }
        );
    }
}
