use std::hash::Hash;
use serde::{Serialize, Deserialize};

#[derive(Copy, Clone, Eq, PartialEq, Hash, Default, Debug, Serialize, Deserialize)]
#[repr(u8)]
pub enum VoxelType {
    #[default]
    Air = 0,
    TopSoil = 1,
    SubSoil = 2,
    Rock = 3,
    Bedrock = 4,
    Sand = 5,
    Clay = 6,
    Water = 7,
    Wood = 8,
    Leaves = 9,
    DungeonWall = 10,
    DungeonFloor = 11,
}

// Trait for voxel queries (meshing needs this)
pub trait Voxel {
    fn is_solid(&self) -> bool;
    fn is_transparent(&self) -> bool;
    fn is_liquid(&self) -> bool;
    fn atlas_index(&self) -> u8;
}

impl Voxel for VoxelType {
    fn is_solid(&self) -> bool {
        match self {
            VoxelType::Air | VoxelType::Water => false,
            _ => true,
        }
    }

    fn is_transparent(&self) -> bool {
        matches!(self, VoxelType::Air | VoxelType::Water | VoxelType::Leaves)
    }

    fn is_liquid(&self) -> bool {
        matches!(self, VoxelType::Water)
    }

    fn atlas_index(&self) -> u8 {
        match self {
            VoxelType::Air => 0,
            VoxelType::TopSoil => 0,
            VoxelType::SubSoil => 1,
            VoxelType::Rock => 2,
            VoxelType::Bedrock => 3,
            VoxelType::Sand => 4,
            VoxelType::Clay => 5,
            VoxelType::Water => 6,
            VoxelType::Wood => 8,
            VoxelType::Leaves => 9,
            VoxelType::DungeonWall => 10,
            VoxelType::DungeonFloor => 11,
        }
    }
}

