use crate::constants::{CHUNK_SIZE, CHUNK_SIZE_U32, CHUNK_VOLUME};
use crate::voxel::materials::MaterialId;
use crate::voxel::skirt::ChunkFace;
use crate::voxel::types::{Voxel, VoxelType};
use bevy::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU8, Ordering};

/// States for the memoized [`Chunk::contains_liquid`] cache.
const LIQUID_UNKNOWN: u8 = 0;
const LIQUID_NO: u8 = 1;
const LIQUID_YES: u8 = 2;

// ============================================================================
// Face Visibility (for occlusion culling)
// ============================================================================

/// 15-bit mask indicating which pairs of chunk faces have line-of-sight
/// through air voxels in the chunk interior.
///
/// Used for Minecraft-style occlusion culling: if the camera enters a chunk
/// through face A, it can only see into neighbors accessible through faces
/// that are connected to A.
///
/// Bit layout for 6C2 = 15 face pairs (lexicographic order):
/// ```text
/// Bit  0: NegX ↔ PosX    Bit  5: PosX ↔ NegY    Bit 10: NegY ↔ NegZ
/// Bit  1: NegX ↔ NegY    Bit  6: PosX ↔ PosY    Bit 11: NegY ↔ PosZ
/// Bit  2: NegX ↔ PosY    Bit  7: PosX ↔ NegZ    Bit 12: PosY ↔ NegZ
/// Bit  3: NegX ↔ NegZ    Bit  8: PosX ↔ PosZ    Bit 13: PosY ↔ PosZ
/// Bit  4: NegX ↔ PosZ    Bit  9: NegY ↔ PosY    Bit 14: NegZ ↔ PosZ
/// ```
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FaceVisibility(pub u16);

impl FaceVisibility {
    /// All 15 face pairs in lexicographic order by face index.
    pub const PAIRS: [(ChunkFace, ChunkFace); 15] = [
        (ChunkFace::NegX, ChunkFace::PosX), // 0
        (ChunkFace::NegX, ChunkFace::NegY), // 1
        (ChunkFace::NegX, ChunkFace::PosY), // 2
        (ChunkFace::NegX, ChunkFace::NegZ), // 3
        (ChunkFace::NegX, ChunkFace::PosZ), // 4
        (ChunkFace::PosX, ChunkFace::NegY), // 5
        (ChunkFace::PosX, ChunkFace::PosY), // 6
        (ChunkFace::PosX, ChunkFace::NegZ), // 7
        (ChunkFace::PosX, ChunkFace::PosZ), // 8
        (ChunkFace::NegY, ChunkFace::PosY), // 9
        (ChunkFace::NegY, ChunkFace::NegZ), // 10
        (ChunkFace::NegY, ChunkFace::PosZ), // 11
        (ChunkFace::PosY, ChunkFace::NegZ), // 12
        (ChunkFace::PosY, ChunkFace::PosZ), // 13
        (ChunkFace::NegZ, ChunkFace::PosZ), // 14
    ];

    /// Check if two faces are connected (have line-of-sight through air).
    #[inline]
    pub fn can_see_through(&self, from: ChunkFace, to: ChunkFace) -> bool {
        if from == to {
            return true;
        }
        let idx = Self::pair_index(from, to);
        (self.0 & (1 << idx)) != 0
    }

    /// Set whether two faces are connected.
    #[inline]
    pub fn set_connected(&mut self, from: ChunkFace, to: ChunkFace, connected: bool) {
        if from == to {
            return;
        }
        let idx = Self::pair_index(from, to);
        if connected {
            self.0 |= 1 << idx;
        } else {
            self.0 &= !(1 << idx);
        }
    }

    /// Get the bit index for a face pair (order-independent).
    fn pair_index(a: ChunkFace, b: ChunkFace) -> usize {
        let (a_idx, b_idx) = (a as usize, b as usize);
        let (lo, hi) = if a_idx <= b_idx {
            (a_idx, b_idx)
        } else {
            (b_idx, a_idx)
        };
        // Row starts: [0, 5, 9, 12, 14] for faces 0-4
        // (Triangular number formula, but using lookup to avoid overflow)
        const ROW_STARTS: [usize; 6] = [0, 5, 9, 12, 14, 15];
        ROW_STARTS[lo] + (hi - lo - 1)
    }

    /// All faces connected (empty chunk - light passes through everything).
    #[inline]
    pub fn all_connected() -> Self {
        Self(0x7FFF) // All 15 bits set
    }

    /// No faces connected (solid chunk - no light passes through).
    #[inline]
    pub fn none_connected() -> Self {
        Self(0)
    }

    /// Check if this chunk blocks all visibility (fully solid).
    #[inline]
    pub fn is_fully_occluding(&self) -> bool {
        self.0 == 0
    }

    /// Check if this chunk is fully transparent (empty).
    #[inline]
    pub fn is_fully_transparent(&self) -> bool {
        self.0 == 0x7FFF
    }
}

/// Serializable chunk data (voxels and visibility).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChunkData {
    pub voxels: Vec<VoxelType>,
    #[serde(default)]
    pub material_overrides: Vec<MaterialOverrideData>,
    pub position: IVec3,
    /// Face visibility mask for occlusion culling (optional for backwards compat).
    #[serde(default)]
    pub face_visibility: FaceVisibility,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MaterialOverrideData {
    pub index: u16,
    pub material_id: MaterialId,
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
    /// Full detail (step 1, 18×18×18 grid)
    Lod0,
    /// Half detail (step 2, 10×10×10 grid) - ~75% vertex reduction
    Lod1,
    /// Quarter detail (step 4, 6×6×6 grid) - ~94% vertex reduction
    Lod2,
    /// Proxy/heightfield for extreme distances - ~99% vertex reduction
    Lod3,
    /// Not rendered
    Culled,
}

impl LodLevel {
    pub fn detail_value(&self) -> u8 {
        match self {
            LodLevel::Lod0 => 4,
            LodLevel::Lod1 => 3,
            LodLevel::Lod2 => 2,
            LodLevel::Lod3 => 1,
            LodLevel::Culled => 0,
        }
    }

    pub fn is_lower_detail_than(self, other: LodLevel) -> bool {
        self.detail_value() < other.detail_value()
    }

    pub fn is_higher_detail_than(self, other: LodLevel) -> bool {
        self.detail_value() > other.detail_value()
    }

    /// Index 0–3 for terrain wireframe debug tinting (shader + UV1 encoding).
    pub fn wireframe_lod_index(self) -> u8 {
        match self {
            LodLevel::Lod0 => 0,
            LodLevel::Lod1 => 1,
            LodLevel::Lod2 => 2,
            LodLevel::Lod3 | LodLevel::Culled => 3,
        }
    }

    /// Get the step size for this LOD level (used in mesh generation)
    pub fn step_size(&self) -> u32 {
        match self {
            LodLevel::Lod0 => 1,
            LodLevel::Lod1 => 2,
            LodLevel::Lod2 => 4,
            LodLevel::Lod3 => 8, // Proxy uses larger steps
            LodLevel::Culled => 0,
        }
    }

    pub fn lod_index(&self) -> Option<u8> {
        match self {
            LodLevel::Lod0 => Some(0),
            LodLevel::Lod1 => Some(1),
            LodLevel::Lod2 => Some(2),
            LodLevel::Lod3 => Some(3),
            LodLevel::Culled => None,
        }
    }
}

pub struct Chunk {
    voxels: [VoxelType; CHUNK_VOLUME],
    material_overrides: HashMap<u16, MaterialId>,
    dirty: bool,
    dirty_reasons: u8,
    mesh_entity: Option<Entity>,
    water_mesh_entity: Option<Entity>,
    water_mask_mesh_entity: Option<Entity>,
    position: IVec3, // Chunk coords (not world)
    lod_level: LodLevel,
    /// Cached uniformity state for skipping mesh generation on uniform chunks.
    uniformity: ChunkUniformity,
    /// Face visibility mask for occlusion culling.
    face_visibility: FaceVisibility,
    /// Whether face visibility needs recomputation.
    visibility_dirty: bool,
    /// Hash of the mesh-determining LOD inputs `(target_mode, effective mesh LOD,
    /// effective neighbor LODs)` from the last committed terrain mesh. Lets the
    /// LOD-churn path skip re-meshing a chunk whose only dirty reason is
    /// `NeighborLod` and whose inputs are unchanged (no visible change, byte-
    /// identical mesh). `None` until first committed.
    last_terrain_mesh_key: Option<u64>,
    /// Memoized "any liquid voxel" answer for [`Chunk::contains_liquid`]
    /// (LIQUID_UNKNOWN/NO/YES). Atomic so the lazy fill works through `&Chunk`
    /// during whole-world scans; invalidated wherever `uniformity` is.
    contains_liquid_cache: AtomicU8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MeshDirtyReason {
    Lod,
    NeighborLod,
    Generation,
    WaterMaterial,
    TerrainMutation,
}

impl MeshDirtyReason {
    #[inline]
    pub const fn bit(self) -> u8 {
        match self {
            MeshDirtyReason::Lod => 1 << 0,
            MeshDirtyReason::NeighborLod => 1 << 1,
            MeshDirtyReason::Generation => 1 << 2,
            MeshDirtyReason::WaterMaterial => 1 << 3,
            MeshDirtyReason::TerrainMutation => 1 << 4,
        }
    }
}

impl Chunk {
    pub fn new(position: IVec3) -> Self {
        Self {
            voxels: [VoxelType::Air; CHUNK_VOLUME],
            material_overrides: HashMap::new(),
            dirty: true,
            dirty_reasons: MeshDirtyReason::Generation.bit(),
            mesh_entity: None,
            water_mesh_entity: None,
            water_mask_mesh_entity: None,
            position,
            lod_level: LodLevel::Lod0,
            // New chunk is all air, so it's empty
            uniformity: ChunkUniformity::Empty,
            // Empty chunk - all faces connected
            face_visibility: FaceVisibility::all_connected(),
            visibility_dirty: false,
            last_terrain_mesh_key: None,
            // All air: definitively no liquid.
            contains_liquid_cache: AtomicU8::new(LIQUID_NO),
        }
    }

    pub fn with_voxels(position: IVec3, voxels: [VoxelType; CHUNK_VOLUME]) -> Self {
        let uniformity = Self::compute_uniformity_for(&voxels);
        Self {
            voxels,
            material_overrides: HashMap::new(),
            dirty: true,
            dirty_reasons: MeshDirtyReason::Generation.bit(),
            mesh_entity: None,
            water_mesh_entity: None,
            water_mask_mesh_entity: None,
            position,
            lod_level: LodLevel::Lod0,
            uniformity,
            face_visibility: FaceVisibility::all_connected(),
            visibility_dirty: uniformity != ChunkUniformity::Empty,
            last_terrain_mesh_key: None,
            contains_liquid_cache: AtomicU8::new(LIQUID_UNKNOWN),
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

    #[inline]
    pub fn get_material_id(&self, local: UVec3) -> MaterialId {
        debug_assert!(
            is_valid_local(local),
            "Chunk::get_material_id called with out-of-bounds coordinates: {:?}",
            local
        );
        let index = Self::index(local.x as usize, local.y as usize, local.z as usize);
        self.material_overrides
            .get(&(index as u16))
            .copied()
            .unwrap_or_else(|| MaterialId::from_voxel(self.voxels[index]))
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
            self.material_overrides.remove(&(index as u16));
            self.mark_dirty_with_reason(MeshDirtyReason::TerrainMutation);
            // Invalidate cached uniformity since voxel changed
            self.uniformity = ChunkUniformity::Unknown;
            self.contains_liquid_cache
                .store(LIQUID_UNKNOWN, Ordering::Relaxed);
            // Invalidate face visibility since topology changed
            self.visibility_dirty = true;
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
            self.material_overrides.remove(&(index as u16));
            self.mark_dirty_with_reason(MeshDirtyReason::TerrainMutation);
            // Invalidate cached uniformity since voxel changed
            self.uniformity = ChunkUniformity::Unknown;
            self.contains_liquid_cache
                .store(LIQUID_UNKNOWN, Ordering::Relaxed);
            // Invalidate face visibility since topology changed
            self.visibility_dirty = true;
        }
        true
    }

    #[inline]
    pub fn set_material_id(&mut self, local: UVec3, material_id: MaterialId) -> bool {
        debug_assert!(
            is_valid_local(local),
            "Chunk::set_material_id called with out-of-bounds coordinates: {:?}",
            local
        );
        let index = Self::index(local.x as usize, local.y as usize, local.z as usize);
        debug_assert!(
            self.voxels[index] != VoxelType::Air,
            "Chunk::set_material_id called for an air voxel at {:?}",
            local
        );
        if self.voxels[index] == VoxelType::Air {
            return false;
        }
        let default_material = MaterialId::from_voxel(self.voxels[index]);
        let current = self
            .material_overrides
            .get(&(index as u16))
            .copied()
            .unwrap_or(default_material);
        if current == material_id {
            return false;
        }

        if material_id == default_material {
            self.material_overrides.remove(&(index as u16));
        } else {
            self.material_overrides.insert(index as u16, material_id);
        }
        self.mark_dirty_with_reason(MeshDirtyReason::TerrainMutation);
        true
    }

    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    pub fn mark_dirty_with_reason(&mut self, reason: MeshDirtyReason) {
        self.dirty = true;
        self.dirty_reasons |= reason.bit();
    }

    pub fn dirty_reason_flags(&self) -> u8 {
        self.dirty_reasons
    }

    pub fn has_dirty_reason(&self, reason: MeshDirtyReason) -> bool {
        self.dirty_reasons & reason.bit() != 0
    }

    pub fn clear_dirty(&mut self) {
        self.dirty = false;
        self.dirty_reasons = 0;
    }

    pub fn reset_dirty_to_reason(&mut self, reason: MeshDirtyReason) {
        self.dirty = true;
        self.dirty_reasons = reason.bit();
    }

    /// Hash of the mesh-determining LOD inputs from the last committed terrain mesh.
    pub fn last_terrain_mesh_key(&self) -> Option<u64> {
        self.last_terrain_mesh_key
    }

    /// Record the mesh-determining LOD inputs of the just-committed terrain mesh, so
    /// a later `NeighborLod`-only dirty with identical inputs can be skipped.
    pub fn set_last_terrain_mesh_key(&mut self, key: u64) {
        self.last_terrain_mesh_key = Some(key);
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

    pub fn set_water_mask_mesh_entity(&mut self, entity: Entity) {
        self.water_mask_mesh_entity = Some(entity);
    }

    pub fn water_mask_mesh_entity(&self) -> Option<Entity> {
        self.water_mask_mesh_entity
    }

    pub fn clear_mesh_entity(&mut self) {
        self.mesh_entity = None;
    }

    pub fn clear_water_mesh_entity(&mut self) {
        self.water_mesh_entity = None;
    }

    pub fn clear_water_mask_mesh_entity(&mut self) {
        self.water_mask_mesh_entity = None;
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
            self.mark_dirty_with_reason(MeshDirtyReason::Lod);
        }
        changed
    }

    pub(crate) fn set_initial_lod_level(&mut self, lod_level: LodLevel) {
        self.lod_level = lod_level;
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

    pub fn iter_materials(&self) -> impl Iterator<Item = (UVec3, VoxelType, MaterialId)> + '_ {
        self.voxels.iter().enumerate().map(|(i, &voxel)| {
            let x = i % CHUNK_SIZE;
            let y = (i / CHUNK_SIZE) % CHUNK_SIZE;
            let z = i / (CHUNK_SIZE * CHUNK_SIZE);
            let material_id = self
                .material_overrides
                .get(&(i as u16))
                .copied()
                .unwrap_or_else(|| MaterialId::from_voxel(voxel));
            (UVec3::new(x as u32, y as u32, z as u32), voxel, material_id)
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
            material_overrides: self.serialized_material_overrides(),
            position: self.position,
            face_visibility: self.face_visibility,
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
        let mut material_overrides = HashMap::new();
        for override_data in data.material_overrides {
            let index = override_data.index as usize;
            if index >= CHUNK_VOLUME {
                continue;
            }
            let voxel = voxels[index];
            if voxel == VoxelType::Air {
                continue;
            }
            let default_material = MaterialId::from_voxel(voxel);
            if override_data.material_id != default_material {
                material_overrides.insert(override_data.index, override_data.material_id);
            }
        }
        // If face_visibility is default (0), mark as dirty to recompute
        let visibility_dirty = data.face_visibility.0 == 0;
        Self {
            voxels,
            material_overrides,
            dirty: true, // Mark dirty so mesh gets generated
            dirty_reasons: MeshDirtyReason::Generation.bit(),
            mesh_entity: None,
            water_mesh_entity: None,
            water_mask_mesh_entity: None,
            position: data.position,
            lod_level: LodLevel::Lod0,
            uniformity: ChunkUniformity::Unknown, // Will be computed on first mesh attempt
            face_visibility: data.face_visibility,
            visibility_dirty,
            last_terrain_mesh_key: None,
            contains_liquid_cache: AtomicU8::new(LIQUID_UNKNOWN),
        }
    }

    pub fn data_from_legacy_material_ids(
        voxels: Vec<VoxelType>,
        material_ids: Vec<MaterialId>,
        position: IVec3,
        face_visibility: FaceVisibility,
    ) -> ChunkData {
        let material_overrides = material_ids
            .into_iter()
            .enumerate()
            .filter_map(|(index, material_id)| {
                let voxel = voxels.get(index).copied().unwrap_or(VoxelType::Air);
                (index < CHUNK_VOLUME
                    && voxel != VoxelType::Air
                    && material_id != MaterialId::from_voxel(voxel))
                .then_some(MaterialOverrideData {
                    index: index as u16,
                    material_id,
                })
            })
            .collect();

        ChunkData {
            voxels,
            material_overrides,
            position,
            face_visibility,
        }
    }

    fn serialized_material_overrides(&self) -> Vec<MaterialOverrideData> {
        let mut entries = self
            .material_overrides
            .iter()
            .filter_map(|(&index, &material_id)| {
                let voxel = self.voxels[index as usize];
                (voxel != VoxelType::Air && material_id != MaterialId::from_voxel(voxel))
                    .then_some(MaterialOverrideData { index, material_id })
            })
            .collect::<Vec<_>>();
        entries.sort_by_key(|entry| entry.index);
        entries
    }

    // =========================================================================
    // Uniformity Methods
    // =========================================================================

    /// Whether any voxel in this chunk is liquid. Memoized: the first call
    /// after a mutation scans the 4096 voxels once; subsequent calls are a
    /// single atomic load. Used by the whole-world water-shore LOD guard,
    /// which previously paid the full scan per chunk per LOD pass.
    pub fn contains_liquid(&self) -> bool {
        match self.contains_liquid_cache.load(Ordering::Relaxed) {
            LIQUID_NO => false,
            LIQUID_YES => true,
            _ => {
                let result = self.voxels.iter().any(|voxel| voxel.is_liquid());
                self.contains_liquid_cache.store(
                    if result { LIQUID_YES } else { LIQUID_NO },
                    Ordering::Relaxed,
                );
                result
            }
        }
    }

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

        self.uniformity = Self::compute_uniformity_for(&self.voxels);
        self.uniformity
    }

    fn compute_uniformity_for(voxels: &[VoxelType; CHUNK_VOLUME]) -> ChunkUniformity {
        let first_voxel = voxels[0];
        let mut all_same = true;

        for &voxel in &voxels[1..] {
            if voxel != first_voxel {
                all_same = false;
                break;
            }
        }

        if all_same {
            if first_voxel == VoxelType::Air {
                ChunkUniformity::Empty
            } else {
                ChunkUniformity::Solid
            }
        } else {
            ChunkUniformity::Mixed
        }
    }

    /// Invalidates the cached uniformity state, forcing recomputation on next check.
    #[inline]
    pub fn invalidate_uniformity(&mut self) {
        self.uniformity = ChunkUniformity::Unknown;
    }

    // =========================================================================
    // Face Visibility Methods (for occlusion culling)
    // =========================================================================

    /// Returns the face visibility mask for this chunk.
    #[inline]
    pub fn face_visibility(&self) -> FaceVisibility {
        self.face_visibility
    }

    /// Sets the face visibility mask for this chunk.
    #[inline]
    pub fn set_face_visibility(&mut self, vis: FaceVisibility) {
        self.face_visibility = vis;
    }

    /// Returns whether face visibility needs recomputation.
    #[inline]
    pub fn is_visibility_dirty(&self) -> bool {
        self.visibility_dirty
    }

    /// Marks face visibility as needing recomputation.
    #[inline]
    pub fn mark_visibility_dirty(&mut self) {
        self.visibility_dirty = true;
    }

    /// Clears the visibility dirty flag after recomputation.
    #[inline]
    pub fn clear_visibility_dirty(&mut self) {
        self.visibility_dirty = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_materials_do_not_serialize_overrides() {
        let mut chunk = Chunk::new(IVec3::ZERO);
        let local = UVec3::new(1, 2, 3);

        chunk.set(local, VoxelType::Rock);
        assert_eq!(
            chunk.get_material_id(local),
            MaterialId::from_voxel(VoxelType::Rock)
        );

        let data = chunk.to_data();
        assert!(data.material_overrides.is_empty());
    }

    #[test]
    fn custom_materials_serialize_sparse_overrides() {
        let mut chunk = Chunk::new(IVec3::ZERO);
        let local = UVec3::new(1, 2, 3);

        chunk.set(local, VoxelType::Rock);
        assert!(chunk.set_material_id(local, MaterialId(6)));

        let data = chunk.to_data();
        assert_eq!(data.material_overrides.len(), 1);
        assert_eq!(
            data.material_overrides[0],
            MaterialOverrideData {
                index: Chunk::index(1, 2, 3) as u16,
                material_id: MaterialId(6),
            }
        );

        let restored = Chunk::from_data(data);
        assert_eq!(restored.get(local), VoxelType::Rock);
        assert_eq!(restored.get_material_id(local), MaterialId(6));
    }

    #[test]
    fn setting_voxel_resets_material_override_to_voxel_default() {
        let mut chunk = Chunk::new(IVec3::ZERO);
        let local = UVec3::new(1, 2, 3);

        chunk.set(local, VoxelType::Rock);
        assert!(chunk.set_material_id(local, MaterialId(6)));
        chunk.set(local, VoxelType::Sand);

        assert_eq!(
            chunk.get_material_id(local),
            MaterialId::from_voxel(VoxelType::Sand)
        );
        assert!(chunk.to_data().material_overrides.is_empty());
    }

    #[test]
    fn legacy_material_ids_convert_to_only_non_default_overrides() {
        let mut voxels = vec![VoxelType::Air; CHUNK_VOLUME];
        let index = Chunk::index(1, 2, 3);
        voxels[index] = VoxelType::Rock;
        let mut material_ids = voxels
            .iter()
            .copied()
            .map(MaterialId::from_voxel)
            .collect::<Vec<_>>();
        material_ids[index] = MaterialId(6);

        let data = Chunk::data_from_legacy_material_ids(
            voxels,
            material_ids,
            IVec3::ZERO,
            FaceVisibility::default(),
        );

        assert_eq!(data.material_overrides.len(), 1);
        assert_eq!(data.material_overrides[0].index, index as u16);
        assert_eq!(data.material_overrides[0].material_id, MaterialId(6));
    }
}
