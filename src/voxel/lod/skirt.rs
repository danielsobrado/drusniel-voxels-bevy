use crate::voxel::chunk::LodLevel;
use bevy::prelude::Vec3;

/// Flags indicating which chunk faces a vertex touches.
#[derive(Clone, Copy, Default)]
pub struct BoundaryFlags {
    pub neg_x: bool,
    pub pos_x: bool,
    pub neg_y: bool,
    pub pos_y: bool,
    pub neg_z: bool,
    pub pos_z: bool,
}

impl BoundaryFlags {
    pub fn is_boundary(&self) -> bool {
        self.neg_x || self.pos_x || self.neg_y || self.pos_y || self.neg_z || self.pos_z
    }

    pub fn on_face(&self, face: ChunkFace) -> bool {
        match face {
            ChunkFace::NegX => self.neg_x,
            ChunkFace::PosX => self.pos_x,
            ChunkFace::NegZ => self.neg_z,
            ChunkFace::PosZ => self.pos_z,
            ChunkFace::NegY => self.neg_y,
            ChunkFace::PosY => self.pos_y,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub enum ChunkFace {
    NegX = 0,
    PosX = 1,
    NegY = 2,
    PosY = 3,
    NegZ = 4,
    PosZ = 5,
}

impl ChunkFace {
    /// All six faces in index order.
    pub const ALL: [ChunkFace; 6] = [
        ChunkFace::NegX,
        ChunkFace::PosX,
        ChunkFace::NegY,
        ChunkFace::PosY,
        ChunkFace::NegZ,
        ChunkFace::PosZ,
    ];

    /// Returns the opposite face.
    #[inline]
    pub fn opposite(self) -> ChunkFace {
        match self {
            ChunkFace::NegX => ChunkFace::PosX,
            ChunkFace::PosX => ChunkFace::NegX,
            ChunkFace::NegY => ChunkFace::PosY,
            ChunkFace::PosY => ChunkFace::NegY,
            ChunkFace::NegZ => ChunkFace::PosZ,
            ChunkFace::PosZ => ChunkFace::NegZ,
        }
    }

    /// Returns the direction vector for this face (pointing outward).
    #[inline]
    pub fn direction(self) -> bevy::prelude::IVec3 {
        match self {
            ChunkFace::NegX => bevy::prelude::IVec3::NEG_X,
            ChunkFace::PosX => bevy::prelude::IVec3::X,
            ChunkFace::NegY => bevy::prelude::IVec3::NEG_Y,
            ChunkFace::PosY => bevy::prelude::IVec3::Y,
            ChunkFace::NegZ => bevy::prelude::IVec3::NEG_Z,
            ChunkFace::PosZ => bevy::prelude::IVec3::Z,
        }
    }
}

/// Determine boundary flags for a vertex in chunk-local voxel units.
pub fn compute_boundary_flags(
    local_pos: Vec3,
    chunk_size: f32,
    boundary_band: f32,
) -> BoundaryFlags {
    let band = boundary_band.max(0.0);

    BoundaryFlags {
        neg_x: local_pos.x <= band,
        pos_x: local_pos.x >= chunk_size - band,
        neg_y: local_pos.y <= band,
        pos_y: local_pos.y >= chunk_size - band,
        neg_z: local_pos.z <= band,
        pos_z: local_pos.z >= chunk_size - band,
    }
}

/// Neighbor LOD information for transition-aware material/SDF sampling.
#[derive(Clone, Copy, Debug, Default)]
pub struct NeighborLods {
    pub neg_x: Option<LodLevel>,
    pub pos_x: Option<LodLevel>,
    pub neg_y: Option<LodLevel>,
    pub pos_y: Option<LodLevel>,
    pub neg_z: Option<LodLevel>,
    pub pos_z: Option<LodLevel>,
}
