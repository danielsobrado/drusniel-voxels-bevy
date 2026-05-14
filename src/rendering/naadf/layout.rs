use bevy::prelude::*;

use crate::constants::{CHUNK_SIZE, CHUNK_SIZE_U32, CHUNK_VOLUME};

pub const VOXELS_PER_BLOCK_AXIS: u32 = 4;
pub const BLOCKS_PER_CHUNK_AXIS: u32 = 4;
pub const VOXELS_PER_CHUNK_AXIS: u32 = CHUNK_SIZE_U32;
pub const VOXELS_PER_BLOCK: u32 = 64;
pub const BLOCKS_PER_CHUNK: u32 = 64;
pub const VOXELS_PER_CHUNK: u32 = CHUNK_VOLUME as u32;

const NODE_STATE_SHIFT: u32 = 30;
const NODE_PAYLOAD_MASK: u32 = (1 << NODE_STATE_SHIFT) - 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum NaadfNodeState {
    UniformEmpty = 0,
    UniformFull = 1,
    Children = 2,
    Reserved = 3,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PackedNaadfNode(pub u32);

impl PackedNaadfNode {
    pub fn new(state: NaadfNodeState, payload: u32) -> Self {
        Self(((state as u32) << NODE_STATE_SHIFT) | (payload & NODE_PAYLOAD_MASK))
    }

    pub fn state(self) -> NaadfNodeState {
        match self.0 >> NODE_STATE_SHIFT {
            0 => NaadfNodeState::UniformEmpty,
            1 => NaadfNodeState::UniformFull,
            2 => NaadfNodeState::Children,
            _ => NaadfNodeState::Reserved,
        }
    }

    pub fn payload(self) -> u32 {
        self.0 & NODE_PAYLOAD_MASK
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NaadfAxisDirection {
    NegX,
    PosX,
    NegY,
    PosY,
    NegZ,
    PosZ,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct DirectionalBounds {
    pub neg_x: u8,
    pub pos_x: u8,
    pub neg_y: u8,
    pub pos_y: u8,
    pub neg_z: u8,
    pub pos_z: u8,
}

impl DirectionalBounds {
    pub const fn empty_block() -> Self {
        Self {
            neg_x: VOXELS_PER_BLOCK_AXIS as u8,
            pos_x: VOXELS_PER_BLOCK_AXIS as u8,
            neg_y: VOXELS_PER_BLOCK_AXIS as u8,
            pos_y: VOXELS_PER_BLOCK_AXIS as u8,
            neg_z: VOXELS_PER_BLOCK_AXIS as u8,
            pos_z: VOXELS_PER_BLOCK_AXIS as u8,
        }
    }

    pub const fn full_block() -> Self {
        Self {
            neg_x: 0,
            pos_x: 0,
            neg_y: 0,
            pos_y: 0,
            neg_z: 0,
            pos_z: 0,
        }
    }

    pub fn get(self, direction: NaadfAxisDirection) -> u8 {
        match direction {
            NaadfAxisDirection::NegX => self.neg_x,
            NaadfAxisDirection::PosX => self.pos_x,
            NaadfAxisDirection::NegY => self.neg_y,
            NaadfAxisDirection::PosY => self.pos_y,
            NaadfAxisDirection::NegZ => self.neg_z,
            NaadfAxisDirection::PosZ => self.pos_z,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NaadfBlock {
    pub node: PackedNaadfNode,
    pub bounds: DirectionalBounds,
    pub occupancy_mask: u64,
    pub material_ids: [u16; VOXELS_PER_BLOCK as usize],
}

impl Default for NaadfBlock {
    fn default() -> Self {
        Self {
            node: PackedNaadfNode::new(NaadfNodeState::UniformEmpty, 0),
            bounds: DirectionalBounds::empty_block(),
            occupancy_mask: 0,
            material_ids: [0; VOXELS_PER_BLOCK as usize],
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NaadfChunk {
    pub position: IVec3,
    pub node: PackedNaadfNode,
    pub blocks: Vec<NaadfBlock>,
    pub occupancy: [bool; CHUNK_VOLUME],
    pub material_ids: [u16; CHUNK_VOLUME],
}

impl NaadfChunk {
    pub fn is_occupied(&self, local: UVec3) -> bool {
        self.occupancy[voxel_index_in_chunk(local)]
    }

    pub fn material_id(&self, local: UVec3) -> u16 {
        self.material_ids[voxel_index_in_chunk(local)]
    }
}

pub fn voxel_index_in_chunk(local: UVec3) -> usize {
    debug_assert!(
        local.x < VOXELS_PER_CHUNK_AXIS
            && local.y < VOXELS_PER_CHUNK_AXIS
            && local.z < VOXELS_PER_CHUNK_AXIS
    );
    (local.x + local.y * VOXELS_PER_CHUNK_AXIS + local.z * VOXELS_PER_CHUNK_AXIS.pow(2)) as usize
}

pub fn block_index_in_chunk(block: UVec3) -> usize {
    debug_assert!(
        block.x < BLOCKS_PER_CHUNK_AXIS
            && block.y < BLOCKS_PER_CHUNK_AXIS
            && block.z < BLOCKS_PER_CHUNK_AXIS
    );
    (block.x + block.y * BLOCKS_PER_CHUNK_AXIS + block.z * BLOCKS_PER_CHUNK_AXIS.pow(2)) as usize
}

pub fn voxel_index_in_block(local: UVec3) -> usize {
    debug_assert!(
        local.x < VOXELS_PER_BLOCK_AXIS
            && local.y < VOXELS_PER_BLOCK_AXIS
            && local.z < VOXELS_PER_BLOCK_AXIS
    );
    (local.x + local.y * VOXELS_PER_BLOCK_AXIS + local.z * VOXELS_PER_BLOCK_AXIS.pow(2)) as usize
}

pub fn block_coord_for_voxel(local: UVec3) -> UVec3 {
    local / VOXELS_PER_BLOCK_AXIS
}

pub fn local_coord_in_block(local: UVec3) -> UVec3 {
    UVec3::new(
        local.x % VOXELS_PER_BLOCK_AXIS,
        local.y % VOXELS_PER_BLOCK_AXIS,
        local.z % VOXELS_PER_BLOCK_AXIS,
    )
}

pub fn chunk_world_origin(chunk_pos: IVec3) -> IVec3 {
    chunk_pos * CHUNK_SIZE as i32
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voxel::chunk::Chunk;

    #[test]
    fn indexing_matches_chunk_layout() {
        for z in [0, 1, 15] {
            for y in [0, 1, 15] {
                for x in [0, 1, 15] {
                    let local = UVec3::new(x, y, z);
                    assert_eq!(
                        voxel_index_in_chunk(local),
                        Chunk::index(x as usize, y as usize, z as usize)
                    );
                }
            }
        }
    }

    #[test]
    fn packed_node_round_trips_state_and_payload() {
        for state in [
            NaadfNodeState::UniformEmpty,
            NaadfNodeState::UniformFull,
            NaadfNodeState::Children,
        ] {
            let node = PackedNaadfNode::new(state, 0x12345);
            assert_eq!(node.state(), state);
            assert_eq!(node.payload(), 0x12345);
        }
    }
}
