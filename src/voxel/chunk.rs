use crate::constants::{CHUNK_SIZE, CHUNK_SIZE_U32, CHUNK_VOLUME};
use crate::voxel::types::VoxelType;
use bevy::prelude::*;
use serde::{Deserialize, Serialize};

/// Serializable chunk data (voxels only).
#[derive(Serialize, Deserialize)]
pub struct ChunkData {
    pub voxels: Vec<VoxelType>,
    pub position: IVec3,
}

/// Represents the uniformity state of a chunk's voxels.
///
/// This is used to skip expensive mesh generation for chunks that are
/// entirely empty (all air) or entirely solid (no internal surfaces).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum ChunkUniformity {
    /// Chunk state hasn't been computed yet.
    #[default]
    Unknown,
    /// All voxels are air - no mesh needed.
    Empty,
    /// All voxels are the same solid (non-air) type - may need boundary faces only.
    Solid,
    /// Mixed voxels - has internal surfaces, needs full mesh generation.
    Mixed,
}

/// Checks if local coordinates are within valid chunk bounds.
#[inline]
pub fn is_valid_local(local: UVec3) -> bool {
    local.x < CHUNK_SIZE_U32 && local.y < CHUNK_SIZE_U32 && local.z < CHUNK_SIZE_U32
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LodLevel {
    High,
    Low,
    Culled,
}

impl LodLevel {
    pub fn detail_value(&self) -> u8 {
        match self {
            LodLevel::High => 2,
            LodLevel::Low => 1,
            LodLevel::Culled => 0,
        }
    }

    pub fn is_lower_detail_than(self, other: LodLevel) -> bool {
        self.detail_value() < other.detail_value()
    }

    pub fn is_higher_detail_than(self, other: LodLevel) -> bool {
        self.detail_value() > other.detail_value()
    }
}

pub struct Chunk {
    voxels: [VoxelType; CHUNK_VOLUME],
    dirty: bool,
    mesh_entity: Option<Entity>,
    water_mesh_entity: Option<Entity>,
    position: IVec3, // Chunk coords (not world)
    lod_level: LodLevel,
    /// Cached uniformity state for skipping mesh generation on uniform chunks.
    uniformity: ChunkUniformity,
}

impl Chunk {
    pub fn new(position: IVec3) -> Self {
        Self {
            voxels: [VoxelType::Air; CHUNK_VOLUME],
            dirty: true,
            mesh_entity: None,
            water_mesh_entity: None,
            position,
            lod_level: LodLevel::High,
            // New chunk is all air, so it's empty
            uniformity: ChunkUniformity::Empty,
        }
    }

    /// Gets the voxel at the given local coordinates.
    ///
    /// # Panics
    /// Panics if coordinates are outside chunk bounds (>= 16).
    /// Use `try_get` for a non-panicking version.
    #[inline]
    pub fn get(&self, local: UVec3) -> VoxelType {
        debug_assert!(
            is_valid_local(local),
            "Chunk::get called with out-of-bounds coordinates: {:?}",
            local
        );
        let index = Self::index(local.x as usize, local.y as usize, local.z as usize);
        self.voxels[index]
    }

    /// Gets the voxel at the given local coordinates, returning None if out of bounds.
    #[inline]
    #[must_use]
    pub fn try_get(&self, local: UVec3) -> Option<VoxelType> {
        if is_valid_local(local) {
            Some(self.voxels[Self::index(local.x as usize, local.y as usize, local.z as usize)])
        } else {
            None
        }
    }

    /// Sets the voxel at the given local coordinates.
    ///
    /// # Panics
    /// Panics if coordinates are outside chunk bounds (>= 16).
    /// Use `try_set` for a non-panicking version.
    #[inline]
    pub fn set(&mut self, local: UVec3, voxel: VoxelType) {
        debug_assert!(
            is_valid_local(local),
            "Chunk::set called with out-of-bounds coordinates: {:?}",
            local
        );
        let index = Self::index(local.x as usize, local.y as usize, local.z as usize);
        if self.voxels[index] != voxel {
            self.voxels[index] = voxel;
            self.dirty = true;
            // Invalidate cached uniformity since voxel changed
            self.uniformity = ChunkUniformity::Unknown;
        }
    }

    /// Sets the voxel at the given local coordinates, returning false if out of bounds.
    #[inline]
    #[must_use]
    pub fn try_set(&mut self, local: UVec3, voxel: VoxelType) -> bool {
        if !is_valid_local(local) {
            return false;
        }
        let index = Self::index(local.x as usize, local.y as usize, local.z as usize);
        if self.voxels[index] != voxel {
            self.voxels[index] = voxel;
            self.dirty = true;
            // Invalidate cached uniformity since voxel changed
            self.uniformity = ChunkUniformity::Unknown;
        }
        true
    }

    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    pub fn mark_dirty(&mut self) {
        self.dirty = true;
    }

    pub fn clear_dirty(&mut self) {
        self.dirty = false;
    }

    pub fn set_mesh_entity(&mut self, entity: Entity) {
        self.mesh_entity = Some(entity);
    }

    pub fn mesh_entity(&self) -> Option<Entity> {
        self.mesh_entity
    }

    pub fn set_water_mesh_entity(&mut self, entity: Entity) {
        self.water_mesh_entity = Some(entity);
    }

    pub fn water_mesh_entity(&self) -> Option<Entity> {
        self.water_mesh_entity
    }

    pub fn clear_mesh_entity(&mut self) {
        self.mesh_entity = None;
    }

    pub fn clear_water_mesh_entity(&mut self) {
        self.water_mesh_entity = None;
    }

    pub fn position(&self) -> IVec3 {
        self.position
    }

    pub fn lod_level(&self) -> LodLevel {
        self.lod_level
    }

    pub fn set_lod_level(&mut self, lod_level: LodLevel) -> bool {
        let changed = self.lod_level != lod_level;
        if changed {
            self.lod_level = lod_level;
            self.dirty = true;
        }
        changed
    }

    /// Converts local 3D coordinates to a linear index.
    ///
    /// Index layout: x + y*16 + z*256 (X-major ordering).
    #[inline]
    pub fn index(x: usize, y: usize, z: usize) -> usize {
        x + (y * CHUNK_SIZE) + (z * CHUNK_SIZE * CHUNK_SIZE)
    }

    /// Converts a linear index back to 3D local coordinates.
    ///
    /// Inverse of `index()`.
    #[inline]
    pub fn coords(index: usize) -> (usize, usize, usize) {
        let x = index % CHUNK_SIZE;
        let y = (index / CHUNK_SIZE) % CHUNK_SIZE;
        let z = index / (CHUNK_SIZE * CHUNK_SIZE);
        (x, y, z)
    }

    /// Returns an iterator over all voxels with their local coordinates.
    pub fn iter(&self) -> impl Iterator<Item = (UVec3, VoxelType)> + '_ {
        self.voxels.iter().enumerate().map(|(i, &voxel)| {
            let (x, y, z) = Self::coords(i);
            (UVec3::new(x as u32, y as u32, z as u32), voxel)
        })
    }

    /// Returns an iterator over all non-air voxels with their local coordinates.
    pub fn iter_solid(&self) -> impl Iterator<Item = (UVec3, VoxelType)> + '_ {
        self.iter().filter(|(_, voxel)| *voxel != VoxelType::Air)
    }

    /// Convert chunk to serializable data
    pub fn to_data(&self) -> ChunkData {
        ChunkData {
            voxels: self.voxels.to_vec(),
            position: self.position,
        }
    }

    /// Create chunk from serializable data
    pub fn from_data(data: ChunkData) -> Self {
        let mut voxels = [VoxelType::Air; CHUNK_VOLUME];
        for (i, v) in data.voxels.into_iter().enumerate() {
            if i < CHUNK_VOLUME {
                voxels[i] = v;
            }
        }
        Self {
            voxels,
            dirty: true, // Mark dirty so mesh gets generated
            mesh_entity: None,
            water_mesh_entity: None,
            position: data.position,
            lod_level: LodLevel::High,
            uniformity: ChunkUniformity::Unknown, // Will be computed on first mesh attempt
        }
    }

    // =========================================================================
    // Uniformity Methods
    // =========================================================================

    /// Returns the cached uniformity state of this chunk.
    #[inline]
    pub fn uniformity(&self) -> ChunkUniformity {
        self.uniformity
    }

    /// Returns true if all voxels in this chunk are air.
    ///
    /// This is a cached check - call `compute_uniformity()` first if the
    /// uniformity state is `Unknown`.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.uniformity == ChunkUniformity::Empty
    }

    /// Returns true if all voxels in this chunk are the same solid type.
    ///
    /// This is a cached check - call `compute_uniformity()` first if the
    /// uniformity state is `Unknown`.
    #[inline]
    pub fn is_fully_solid(&self) -> bool {
        self.uniformity == ChunkUniformity::Solid
    }

    /// Returns true if this chunk has mixed voxel types (internal surfaces).
    ///
    /// This is a cached check - call `compute_uniformity()` first if the
    /// uniformity state is `Unknown`.
    #[inline]
    pub fn has_surface(&self) -> bool {
        self.uniformity == ChunkUniformity::Mixed
    }

    /// Computes and caches the uniformity state by scanning all voxels.
    ///
    /// Returns the computed uniformity state.
    pub fn compute_uniformity(&mut self) -> ChunkUniformity {
        if self.uniformity != ChunkUniformity::Unknown {
            return self.uniformity;
        }

        let first_voxel = self.voxels[0];
        let mut all_same = true;

        for &voxel in &self.voxels[1..] {
            if voxel != first_voxel {
                all_same = false;
                break;
            }
        }

        self.uniformity = if all_same {
            if first_voxel == VoxelType::Air {
                ChunkUniformity::Empty
            } else {
                ChunkUniformity::Solid
            }
        } else {
            ChunkUniformity::Mixed
        };

        self.uniformity
    }

    /// Invalidates the cached uniformity state, forcing recomputation on next check.
    #[inline]
    pub fn invalidate_uniformity(&mut self) {
        self.uniformity = ChunkUniformity::Unknown;
    }
}
