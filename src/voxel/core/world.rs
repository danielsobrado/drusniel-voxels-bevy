use crate::constants::{BEDROCK_DEPTH, CHUNK_SIZE_I32, MIN_BREAKABLE_Y, WORLD_KILL_Y};
use crate::terrain::generation::config::terrain_config_fingerprint;
use crate::voxel::chunk::{Chunk, MeshDirtyReason};
use crate::voxel::materials::{MaterialId, MaterialReplaceSummary};
use crate::voxel::mesh_invalidation::{
    CHUNK_FACE_NEIGHBOR_OFFSETS, mesh_invalidation_neighbor_offsets,
};
use crate::voxel::persistence::WorldData;
use crate::voxel::types::VoxelType;
use crate::world_rules::{ProtectedAreaRegistry, ProtectedEditIntent};
use bevy::prelude::*;
// Bevy's hashbrown maps (foldhash) instead of std's SipHash: every voxel
// sample anywhere in the engine funnels through `chunks.get(&chunk_pos)`, so
// the per-lookup hash cost is hot.
use bevy::platform::collections::{HashMap, HashSet};
use std::ops::{Deref, DerefMut};

#[derive(Resource, Clone, Copy, Debug, PartialEq, Eq)]
pub struct WorldBounds {
    pub min_chunk: IVec3,
    pub max_chunk: IVec3,
    pub min_world_y: i32,
    pub max_world_y: i32,
    pub min_breakable_y: i32,
    pub kill_y: i32,
    pub bedrock_floor_y: i32,
    pub horizontal_min: IVec2,
    pub horizontal_max: IVec2,
}

impl WorldBounds {
    pub fn from_size_chunks(size_chunks: IVec3) -> Self {
        let world_size = size_chunks * CHUNK_SIZE_I32;
        Self {
            min_chunk: IVec3::ZERO,
            max_chunk: size_chunks - IVec3::ONE,
            min_world_y: 0,
            max_world_y: world_size.y - 1,
            min_breakable_y: MIN_BREAKABLE_Y,
            kill_y: WORLD_KILL_Y,
            bedrock_floor_y: BEDROCK_DEPTH,
            horizontal_min: IVec2::ZERO,
            horizontal_max: IVec2::new(world_size.x - 1, world_size.z - 1),
        }
    }

    #[inline]
    pub fn contains_horizontal(self, world_pos: IVec3) -> bool {
        world_pos.x >= self.horizontal_min.x
            && world_pos.x <= self.horizontal_max.x
            && world_pos.z >= self.horizontal_min.y
            && world_pos.z <= self.horizontal_max.y
    }

    #[inline]
    pub fn contains_world_y(self, world_y: i32) -> bool {
        world_y >= self.min_world_y && world_y <= self.max_world_y
    }

    #[inline]
    pub fn contains_world_pos(self, world_pos: IVec3) -> bool {
        self.contains_horizontal(world_pos) && self.contains_world_y(world_pos.y)
    }

    #[inline]
    pub fn effective_horizontal_margin(self, requested_margin: i32) -> IVec2 {
        let x_span = self.horizontal_max.x - self.horizontal_min.x + 1;
        let z_span = self.horizontal_max.y - self.horizontal_min.y + 1;
        IVec2::new(
            requested_margin.max(0).min((x_span - 1).max(0) / 2),
            requested_margin.max(0).min((z_span - 1).max(0) / 2),
        )
    }

    #[inline]
    pub fn inside_horizontal_edge_margin(self, world_pos: IVec3, requested_margin: i32) -> bool {
        let margin = self.effective_horizontal_margin(requested_margin);
        let x_edge_distance =
            (world_pos.x - self.horizontal_min.x).min(self.horizontal_max.x - world_pos.x);
        let z_edge_distance =
            (world_pos.z - self.horizontal_min.y).min(self.horizontal_max.y - world_pos.z);

        x_edge_distance < margin.x || z_edge_distance < margin.y
    }

    #[inline]
    pub fn clamp_horizontal_position(self, position: Vec3, requested_margin: i32) -> Vec3 {
        let margin = self.effective_horizontal_margin(requested_margin);
        let min_x = (self.horizontal_min.x + margin.x) as f32;
        let max_x = (self.horizontal_max.x - margin.x) as f32;
        let min_z = (self.horizontal_min.y + margin.y) as f32;
        let max_z = (self.horizontal_max.y - margin.y) as f32;

        Vec3::new(
            position.x.clamp(min_x, max_x),
            position.y,
            position.z.clamp(min_z, max_z),
        )
    }

    #[inline]
    pub fn is_breakable_y(self, world_y: i32) -> bool {
        world_y >= self.min_breakable_y && world_y <= self.max_world_y
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VoxelSample {
    InBounds(VoxelType),
    OutsideBelowWorld,
    OutsideAboveWorld,
    OutsideHorizontalWorld,
    MissingChunkInsideBounds,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VoxelEditResult {
    Applied,
    NoChange,
    RejectedOutOfBounds,
    RejectedBelowWorldFloor,
    RejectedUnbreakable,
    RejectedMissingChunk,
    RejectedProtectedArea,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct VoxelEditStats {
    pub applied: u64,
    pub no_change: u64,
    pub rejected_out_of_bounds: u64,
    pub rejected_below_floor: u64,
    pub rejected_unbreakable: u64,
    pub rejected_missing_chunk: u64,
    pub rejected_protected_area: u64,
}

impl VoxelEditStats {
    pub fn record(&mut self, result: VoxelEditResult) {
        match result {
            VoxelEditResult::Applied => self.applied += 1,
            VoxelEditResult::NoChange => self.no_change += 1,
            VoxelEditResult::RejectedOutOfBounds => self.rejected_out_of_bounds += 1,
            VoxelEditResult::RejectedBelowWorldFloor => self.rejected_below_floor += 1,
            VoxelEditResult::RejectedUnbreakable => self.rejected_unbreakable += 1,
            VoxelEditResult::RejectedMissingChunk => self.rejected_missing_chunk += 1,
            VoxelEditResult::RejectedProtectedArea => self.rejected_protected_area += 1,
        }
    }
}

impl VoxelEditResult {
    #[inline]
    pub fn applied(self) -> bool {
        matches!(self, Self::Applied | Self::NoChange)
    }

    #[inline]
    pub fn rejected(self) -> bool {
        !self.applied()
    }
}

impl VoxelSample {
    #[inline]
    pub fn voxel(self) -> Option<VoxelType> {
        match self {
            Self::InBounds(voxel) => Some(voxel),
            Self::OutsideBelowWorld
            | Self::OutsideAboveWorld
            | Self::OutsideHorizontalWorld
            | Self::MissingChunkInsideBounds => None,
        }
    }

    #[inline]
    pub fn is_in_bounds(self) -> bool {
        matches!(self, Self::InBounds(_))
    }

    #[inline]
    pub fn is_boundary(self) -> bool {
        matches!(
            self,
            Self::OutsideBelowWorld | Self::OutsideAboveWorld | Self::OutsideHorizontalWorld
        )
    }

    #[inline]
    pub fn is_missing_chunk_inside_bounds(self) -> bool {
        matches!(self, Self::MissingChunkInsideBounds)
    }

    #[inline]
    pub fn terrain_meshing_voxel(self) -> VoxelType {
        match self {
            Self::InBounds(voxel) => voxel,
            Self::OutsideAboveWorld | Self::OutsideHorizontalWorld => VoxelType::Air,
            Self::OutsideBelowWorld | Self::MissingChunkInsideBounds => VoxelType::Bedrock,
        }
    }

    #[inline]
    pub fn water_meshing_voxel(self) -> VoxelType {
        match self {
            Self::InBounds(voxel) => voxel,
            Self::OutsideAboveWorld => VoxelType::Air,
            Self::OutsideBelowWorld
            | Self::OutsideHorizontalWorld
            | Self::MissingChunkInsideBounds => VoxelType::Bedrock,
        }
    }

    #[inline]
    pub fn collision_voxel(self) -> VoxelType {
        match self {
            Self::InBounds(voxel) => voxel,
            Self::OutsideAboveWorld => VoxelType::Air,
            Self::OutsideBelowWorld
            | Self::OutsideHorizontalWorld
            | Self::MissingChunkInsideBounds => VoxelType::Bedrock,
        }
    }
}

#[derive(Resource)]
pub struct VoxelWorld {
    chunks: HashMap<IVec3, Chunk>,
    dirty_chunks: HashSet<IVec3>,
    derived_dirty_chunks: HashSet<IVec3>,
    world_size_chunks: IVec3,
    bounds: WorldBounds,
    edit_stats: VoxelEditStats,
}

pub struct ChunkMut<'a> {
    position: IVec3,
    chunk: &'a mut Chunk,
    dirty_chunks: &'a mut HashSet<IVec3>,
    derived_dirty_chunks: &'a mut HashSet<IVec3>,
}

impl Deref for ChunkMut<'_> {
    type Target = Chunk;

    fn deref(&self) -> &Self::Target {
        self.chunk
    }
}

impl DerefMut for ChunkMut<'_> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.chunk
    }
}

impl Drop for ChunkMut<'_> {
    fn drop(&mut self) {
        if self.chunk.is_dirty() {
            self.dirty_chunks.insert(self.position);
            self.derived_dirty_chunks.insert(self.position);
        } else {
            self.dirty_chunks.remove(&self.position);
        }
    }
}

impl VoxelWorld {
    pub fn new(size_chunks: IVec3) -> Self {
        Self {
            chunks: HashMap::new(),
            dirty_chunks: HashSet::new(),
            derived_dirty_chunks: HashSet::new(),
            world_size_chunks: size_chunks,
            bounds: WorldBounds::from_size_chunks(size_chunks),
            edit_stats: VoxelEditStats::default(),
        }
    }

    // Chunk access
    pub fn get_chunk(&self, chunk_pos: IVec3) -> Option<&Chunk> {
        self.chunks.get(&chunk_pos)
    }

    pub fn get_chunk_mut(&mut self, chunk_pos: IVec3) -> Option<ChunkMut<'_>> {
        let chunk = self.chunks.get_mut(&chunk_pos)?;
        Some(ChunkMut {
            position: chunk_pos,
            chunk,
            dirty_chunks: &mut self.dirty_chunks,
            derived_dirty_chunks: &mut self.derived_dirty_chunks,
        })
    }

    pub fn chunk_exists(&self, chunk_pos: IVec3) -> bool {
        self.chunks.contains_key(&chunk_pos)
    }

    pub fn insert_chunk(&mut self, chunk: Chunk) {
        let position = chunk.position();
        if chunk.is_dirty() {
            self.dirty_chunks.insert(position);
            self.derived_dirty_chunks.insert(position);
        } else {
            self.dirty_chunks.remove(&position);
        }
        self.chunks.insert(position, chunk);
    }

    pub fn mark_generation_face_neighbors_dirty(&mut self, chunk_pos: IVec3) {
        for offset in CHUNK_FACE_NEIGHBOR_OFFSETS {
            self.mark_chunk_dirty_with_reason(chunk_pos + offset, MeshDirtyReason::Generation);
        }
    }

    pub fn mark_chunk_dirty_with_reason(
        &mut self,
        chunk_pos: IVec3,
        reason: MeshDirtyReason,
    ) -> bool {
        let Some(mut chunk) = self.get_chunk_mut(chunk_pos) else {
            return false;
        };
        chunk.mark_dirty_with_reason(reason);
        true
    }

    pub fn mark_all_loaded_chunks_dirty_with_reason(&mut self, reason: MeshDirtyReason) {
        let positions: Vec<IVec3> = self.chunks.keys().copied().collect();
        for chunk_pos in positions {
            self.mark_chunk_dirty_with_reason(chunk_pos, reason);
        }
    }

    pub fn mark_chunks_containing_material_dirty_with_reason(
        &mut self,
        material_id: MaterialId,
        reason: MeshDirtyReason,
    ) -> Vec<IVec3> {
        let positions = self
            .chunks
            .iter()
            .filter_map(|(chunk_pos, chunk)| {
                chunk
                    .iter_materials()
                    .any(|(_, voxel, id)| voxel != VoxelType::Air && id == material_id)
                    .then_some(*chunk_pos)
            })
            .collect::<Vec<_>>();

        for chunk_pos in &positions {
            self.mark_chunk_dirty_with_reason(*chunk_pos, reason);
        }

        positions
    }

    // Voxel access (world coordinates)
    pub fn get_voxel(&self, world_pos: IVec3) -> Option<VoxelType> {
        self.sample_voxel_raw(world_pos)
    }

    pub fn get_material_id(&self, world_pos: IVec3) -> Option<MaterialId> {
        let chunk_pos = Self::world_to_chunk(world_pos);
        let local_pos = Self::world_to_local(world_pos);
        self.get_chunk(chunk_pos)
            .map(|chunk| chunk.get_material_id(local_pos))
    }

    pub fn sample_voxel_raw(&self, world_pos: IVec3) -> Option<VoxelType> {
        let chunk_pos = Self::world_to_chunk(world_pos);
        let local_pos = Self::world_to_local(world_pos);
        self.get_chunk(chunk_pos).map(|chunk| chunk.get(local_pos))
    }

    pub fn sample_voxel(&self, world_pos: IVec3) -> VoxelSample {
        if !self.bounds.contains_horizontal(world_pos) {
            return VoxelSample::OutsideHorizontalWorld;
        }
        if world_pos.y < self.bounds.min_world_y {
            return VoxelSample::OutsideBelowWorld;
        }
        if world_pos.y > self.bounds.max_world_y {
            return VoxelSample::OutsideAboveWorld;
        }
        if world_pos.y <= self.bounds.bedrock_floor_y {
            return VoxelSample::InBounds(VoxelType::Bedrock);
        }

        let chunk_pos = Self::world_to_chunk(world_pos);
        if !self.chunk_in_bounds(chunk_pos) {
            return VoxelSample::MissingChunkInsideBounds;
        }

        self.sample_voxel_raw(world_pos)
            .map(VoxelSample::InBounds)
            .unwrap_or(VoxelSample::MissingChunkInsideBounds)
    }

    pub fn sample_voxel_for_terrain_meshing(&self, world_pos: IVec3) -> VoxelSample {
        self.sample_voxel(world_pos)
    }

    pub fn sample_voxel_for_water_meshing(&self, world_pos: IVec3) -> VoxelSample {
        self.sample_voxel(world_pos)
    }

    pub fn sample_voxel_for_collision(&self, world_pos: IVec3) -> VoxelSample {
        self.sample_voxel(world_pos)
    }

    pub fn sample_voxel_for_interaction(&self, world_pos: IVec3) -> VoxelSample {
        self.sample_voxel(world_pos)
    }

    pub fn set_voxel(&mut self, world_pos: IVec3, voxel: VoxelType) -> VoxelEditResult {
        let result = self.apply_voxel_edit(world_pos, voxel);
        self.edit_stats.record(result);
        result
    }

    pub fn set_voxel_with_rules(
        &mut self,
        world_pos: IVec3,
        voxel: VoxelType,
        intent: ProtectedEditIntent,
        protected_areas: Option<&ProtectedAreaRegistry>,
    ) -> VoxelEditResult {
        if let Some(registry) = protected_areas {
            let touches_water = voxel == VoxelType::Water
                || matches!(
                    self.sample_voxel_for_interaction(world_pos),
                    VoxelSample::InBounds(VoxelType::Water)
                );
            if registry.edit_blocked(world_pos, intent)
                || (touches_water
                    && registry.edit_blocked(world_pos, ProtectedEditIntent::EditWater))
            {
                let result = VoxelEditResult::RejectedProtectedArea;
                self.edit_stats.record(result);
                return result;
            }
        }

        self.set_voxel(world_pos, voxel)
    }

    pub fn set_material_id_with_rules(
        &mut self,
        world_pos: IVec3,
        material_id: MaterialId,
        protected_areas: Option<&ProtectedAreaRegistry>,
    ) -> VoxelEditResult {
        if let Some(registry) = protected_areas {
            if registry.edit_blocked(world_pos, ProtectedEditIntent::Paint) {
                let result = VoxelEditResult::RejectedProtectedArea;
                self.edit_stats.record(result);
                return result;
            }
        }

        let result = self.apply_material_edit(world_pos, material_id);
        self.edit_stats.record(result);
        result
    }

    pub fn record_edit_result(&mut self, result: VoxelEditResult) {
        self.edit_stats.record(result);
    }

    fn apply_voxel_edit(&mut self, world_pos: IVec3, voxel: VoxelType) -> VoxelEditResult {
        let sample = self.sample_voxel_for_interaction(world_pos);
        match sample {
            VoxelSample::OutsideBelowWorld => return VoxelEditResult::RejectedBelowWorldFloor,
            VoxelSample::OutsideAboveWorld | VoxelSample::OutsideHorizontalWorld => {
                return VoxelEditResult::RejectedOutOfBounds;
            }
            VoxelSample::MissingChunkInsideBounds => return VoxelEditResult::RejectedMissingChunk,
            VoxelSample::InBounds(VoxelType::Bedrock) if voxel != VoxelType::Bedrock => {
                return VoxelEditResult::RejectedUnbreakable;
            }
            VoxelSample::InBounds(_) if !self.bounds.is_breakable_y(world_pos.y) => {
                return VoxelEditResult::RejectedBelowWorldFloor;
            }
            VoxelSample::InBounds(_) => {}
        }

        let chunk_pos = Self::world_to_chunk(world_pos);
        let local_pos = Self::world_to_local(world_pos);

        let Some(mut chunk) = self.get_chunk_mut(chunk_pos) else {
            return VoxelEditResult::RejectedMissingChunk;
        };
        {
            let previous = chunk.get(local_pos);
            if previous == voxel {
                return VoxelEditResult::NoChange;
            }
            chunk.set(local_pos, voxel);
        }
        drop(chunk);

        for offset in mesh_invalidation_neighbor_offsets(local_pos) {
            self.mark_chunk_dirty_with_reason(chunk_pos + offset, MeshDirtyReason::TerrainMutation);
        }
        VoxelEditResult::Applied
    }

    fn apply_material_edit(
        &mut self,
        world_pos: IVec3,
        material_id: MaterialId,
    ) -> VoxelEditResult {
        let sample = self.sample_voxel_for_interaction(world_pos);
        match sample {
            VoxelSample::OutsideBelowWorld => return VoxelEditResult::RejectedBelowWorldFloor,
            VoxelSample::OutsideAboveWorld | VoxelSample::OutsideHorizontalWorld => {
                return VoxelEditResult::RejectedOutOfBounds;
            }
            VoxelSample::MissingChunkInsideBounds => return VoxelEditResult::RejectedMissingChunk,
            VoxelSample::InBounds(VoxelType::Air) => return VoxelEditResult::NoChange,
            VoxelSample::InBounds(VoxelType::Bedrock) => {
                return VoxelEditResult::RejectedUnbreakable;
            }
            VoxelSample::InBounds(_) if !self.bounds.is_breakable_y(world_pos.y) => {
                return VoxelEditResult::RejectedBelowWorldFloor;
            }
            VoxelSample::InBounds(_) => {}
        }

        let chunk_pos = Self::world_to_chunk(world_pos);
        let local_pos = Self::world_to_local(world_pos);
        let Some(mut chunk) = self.get_chunk_mut(chunk_pos) else {
            return VoxelEditResult::RejectedMissingChunk;
        };

        if chunk.get_material_id(local_pos) == material_id {
            return VoxelEditResult::NoChange;
        }
        chunk.set_material_id(local_pos, material_id);
        VoxelEditResult::Applied
    }

    pub fn replace_material_id(
        &mut self,
        from: MaterialId,
        to: MaterialId,
        protected_areas: Option<&ProtectedAreaRegistry>,
    ) -> MaterialReplaceSummary {
        let mut summary = MaterialReplaceSummary::default();
        let chunk_positions = self.chunks.keys().copied().collect::<Vec<_>>();

        for chunk_pos in chunk_positions {
            summary.merge(self.replace_material_id_in_chunk(chunk_pos, from, to, protected_areas));
        }

        summary
    }

    pub fn replace_material_id_in_chunk(
        &mut self,
        chunk_pos: IVec3,
        from: MaterialId,
        to: MaterialId,
        protected_areas: Option<&ProtectedAreaRegistry>,
    ) -> MaterialReplaceSummary {
        let mut summary = MaterialReplaceSummary::default();
        let bounds = self.bounds;
        let chunk_origin = Self::chunk_to_world(chunk_pos);
        let Some(chunk) = self.chunks.get_mut(&chunk_pos) else {
            return summary;
        };
        let locals = chunk
            .iter_materials()
            .filter_map(|(local, voxel, material_id)| {
                (voxel != VoxelType::Air && voxel != VoxelType::Bedrock && material_id == from)
                    .then_some(local)
            })
            .collect::<Vec<_>>();

        for local in locals {
            let position = chunk_origin + local.as_ivec3();
            if !bounds.is_breakable_y(position.y) {
                summary.skipped += 1;
                continue;
            }
            if let Some(registry) = protected_areas {
                if registry.edit_blocked(position, ProtectedEditIntent::Paint) {
                    summary.skipped += 1;
                    continue;
                }
            }

            if chunk.set_material_id(local, to) {
                summary.changed += 1;
                if !summary.dirty_chunks.contains(&chunk_pos) {
                    summary.dirty_chunks.push(chunk_pos);
                }
            } else {
                summary.no_change += 1;
            }
        }

        if !summary.dirty_chunks.is_empty() {
            self.dirty_chunks.insert(chunk_pos);
            self.derived_dirty_chunks.insert(chunk_pos);
        }

        summary
    }

    // Coordinate conversion
    pub fn world_to_chunk(world_pos: IVec3) -> IVec3 {
        IVec3::new(
            (world_pos.x as f32 / CHUNK_SIZE_I32 as f32).floor() as i32,
            (world_pos.y as f32 / CHUNK_SIZE_I32 as f32).floor() as i32,
            (world_pos.z as f32 / CHUNK_SIZE_I32 as f32).floor() as i32,
        )
    }

    pub fn world_to_local(world_pos: IVec3) -> UVec3 {
        UVec3::new(
            world_pos.x.rem_euclid(CHUNK_SIZE_I32) as u32,
            world_pos.y.rem_euclid(CHUNK_SIZE_I32) as u32,
            world_pos.z.rem_euclid(CHUNK_SIZE_I32) as u32,
        )
    }

    pub fn chunk_to_world(chunk_pos: IVec3) -> IVec3 {
        chunk_pos * CHUNK_SIZE_I32
    }

    // Iteration
    pub fn dirty_chunks(&self) -> impl Iterator<Item = IVec3> + '_ {
        self.dirty_chunks.iter().copied()
    }

    pub fn derived_dirty_chunks(&self) -> impl Iterator<Item = IVec3> + '_ {
        self.derived_dirty_chunks.iter().copied()
    }

    pub fn take_derived_dirty_chunks(&mut self) -> Vec<IVec3> {
        self.derived_dirty_chunks.drain().collect()
    }

    /// Returns an iterator over all chunk positions and their chunks (immutable).
    pub fn chunk_entries(&self) -> impl Iterator<Item = (&IVec3, &Chunk)> {
        self.chunks.iter()
    }

    /// Returns an iterator over all loaded chunk positions.
    pub fn chunk_positions(&self) -> impl Iterator<Item = IVec3> + '_ {
        self.chunks.keys().copied()
    }

    /// Returns the number of loaded chunks.
    pub fn chunk_count(&self) -> usize {
        self.chunks.len()
    }

    pub fn all_chunk_positions(&self) -> impl Iterator<Item = IVec3> + '_ {
        // Generate all positions within world bounds
        // This is a naive implementation, might want to just iterate loaded chunks
        // But for Phase 1 we want to generate the whole world
        let start = IVec3::ZERO;
        let end = self.world_size_chunks;

        (start.x..end.x).flat_map(move |x| {
            (start.y..end.y).flat_map(move |y| (start.z..end.z).map(move |z| IVec3::new(x, y, z)))
        })
    }

    // Bounds checking
    pub fn in_bounds(&self, world_pos: IVec3) -> bool {
        self.bounds.contains_world_pos(world_pos)
    }

    pub fn chunk_in_bounds(&self, chunk_pos: IVec3) -> bool {
        chunk_pos.x >= 0
            && chunk_pos.x < self.world_size_chunks.x
            && chunk_pos.y >= 0
            && chunk_pos.y < self.world_size_chunks.y
            && chunk_pos.z >= 0
            && chunk_pos.z < self.world_size_chunks.z
    }

    pub fn world_size_chunks(&self) -> IVec3 {
        self.world_size_chunks
    }

    pub fn bounds(&self) -> WorldBounds {
        self.bounds
    }

    pub fn edit_stats(&self) -> VoxelEditStats {
        self.edit_stats
    }

    /// Convert world to serializable data
    pub fn to_data(&self) -> WorldData {
        WorldData {
            world_size_chunks: self.world_size_chunks,
            terrain_config_fingerprint: terrain_config_fingerprint(),
            chunks: self.chunks.values().map(|c| c.to_data()).collect(),
        }
    }

    /// Create world from serializable data
    pub fn from_data(data: WorldData) -> Self {
        let mut world = Self::new(data.world_size_chunks);
        for chunk_data in data.chunks {
            let chunk = Chunk::from_data(chunk_data);
            world.insert_chunk(chunk);
        }
        world
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voxel::chunk::Chunk;
    use crate::voxel::materials::MaterialId;

    #[test]
    fn below_world_samples_as_boundary_not_air() {
        let world = VoxelWorld::new(IVec3::new(1, 1, 1));

        assert_eq!(
            world.sample_voxel(IVec3::new(0, -1, 0)),
            VoxelSample::OutsideBelowWorld
        );
        assert_ne!(
            world
                .sample_voxel_for_terrain_meshing(IVec3::new(0, -1, 0))
                .terrain_meshing_voxel(),
            VoxelType::Air
        );
    }

    #[test]
    fn below_world_never_returns_water() {
        let world = VoxelWorld::new(IVec3::new(1, 1, 1));

        assert_ne!(
            world
                .sample_voxel_for_water_meshing(IVec3::new(0, -1, 0))
                .water_meshing_voxel(),
            VoxelType::Water
        );
    }

    #[test]
    fn material_edit_changes_material_without_changing_voxel_type() {
        let mut world = VoxelWorld::new(IVec3::new(1, 1, 1));
        world.insert_chunk(Chunk::new(IVec3::ZERO));
        let position = IVec3::new(4, 8, 4);

        assert_eq!(
            world.set_voxel(position, VoxelType::Rock),
            VoxelEditResult::Applied
        );
        assert_eq!(
            world.set_material_id_with_rules(position, MaterialId(6), None),
            VoxelEditResult::Applied
        );

        assert_eq!(world.get_voxel(position), Some(VoxelType::Rock));
        assert_eq!(world.get_material_id(position), Some(MaterialId(6)));
    }

    #[test]
    fn replace_material_updates_matching_voxels_and_marks_chunks_dirty() {
        let mut world = VoxelWorld::new(IVec3::new(1, 1, 1));
        world.insert_chunk(Chunk::new(IVec3::ZERO));
        let first = IVec3::new(4, 8, 4);
        let second = IVec3::new(5, 8, 4);

        assert_eq!(
            world.set_voxel(first, VoxelType::Rock),
            VoxelEditResult::Applied
        );
        assert_eq!(
            world.set_voxel(second, VoxelType::Rock),
            VoxelEditResult::Applied
        );
        assert_eq!(
            world.set_material_id_with_rules(first, MaterialId(3), None),
            VoxelEditResult::NoChange
        );
        assert_eq!(
            world.set_material_id_with_rules(second, MaterialId(6), None),
            VoxelEditResult::Applied
        );

        let summary = world.replace_material_id(MaterialId(6), MaterialId(5), None);

        assert_eq!(summary.changed, 1);
        assert_eq!(world.get_material_id(first), Some(MaterialId(3)));
        assert_eq!(world.get_material_id(second), Some(MaterialId(5)));
        assert!(summary.dirty_chunks.contains(&IVec3::ZERO));
    }

    #[test]
    fn replace_material_reports_only_chunks_changed_by_replace() {
        let mut world = VoxelWorld::new(IVec3::new(2, 1, 1));
        world.insert_chunk(Chunk::new(IVec3::ZERO));
        world.insert_chunk(Chunk::new(IVec3::X));
        let position = IVec3::new(4, 8, 4);

        assert_eq!(
            world.set_voxel(position, VoxelType::Rock),
            VoxelEditResult::Applied
        );
        assert_eq!(
            world.set_material_id_with_rules(position, MaterialId(6), None),
            VoxelEditResult::Applied
        );
        world.get_chunk_mut(IVec3::ZERO).unwrap().clear_dirty();
        world.get_chunk_mut(IVec3::X).unwrap().clear_dirty();
        world.mark_chunk_dirty_with_reason(IVec3::X, MeshDirtyReason::Generation);

        let summary = world.replace_material_id(MaterialId(6), MaterialId(5), None);

        assert_eq!(summary.changed, 1);
        assert_eq!(summary.dirty_chunks, vec![IVec3::ZERO]);
    }

    #[test]
    fn horizontal_out_of_bounds_is_open_for_terrain_meshing_only() {
        let world = VoxelWorld::new(IVec3::new(1, 1, 1));
        let pos = IVec3::new(-1, BEDROCK_DEPTH + 1, 0);

        assert_eq!(
            world.sample_voxel_for_terrain_meshing(pos),
            VoxelSample::OutsideHorizontalWorld
        );
        assert_eq!(
            world
                .sample_voxel_for_terrain_meshing(pos)
                .terrain_meshing_voxel(),
            VoxelType::Air
        );
        assert_eq!(
            world.sample_voxel_for_collision(pos).collision_voxel(),
            VoxelType::Bedrock
        );
        assert_eq!(
            world
                .sample_voxel_for_water_meshing(pos)
                .water_meshing_voxel(),
            VoxelType::Bedrock
        );
    }

    #[test]
    fn missing_chunk_inside_bounds_is_not_air() {
        let world = VoxelWorld::new(IVec3::new(2, 1, 2));
        let pos = IVec3::new(
            CHUNK_SIZE_I32 + 1,
            world.bounds().min_breakable_y,
            CHUNK_SIZE_I32 + 1,
        );

        assert_eq!(
            world.sample_voxel_for_collision(pos),
            VoxelSample::MissingChunkInsideBounds
        );
        assert_ne!(
            world.sample_voxel_for_collision(pos).collision_voxel(),
            VoxelType::Air
        );
    }

    #[test]
    fn horizontal_edge_margin_detects_guard_strip() {
        let bounds = WorldBounds::from_size_chunks(IVec3::new(4, 1, 4));

        assert!(bounds.inside_horizontal_edge_margin(IVec3::new(0, 1, 24), CHUNK_SIZE_I32));
        assert!(!bounds.inside_horizontal_edge_margin(
            IVec3::new(CHUNK_SIZE_I32, 1, CHUNK_SIZE_I32),
            CHUNK_SIZE_I32
        ));
    }

    #[test]
    fn horizontal_clamp_keeps_position_out_of_guard_strip() {
        let bounds = WorldBounds::from_size_chunks(IVec3::new(4, 1, 4));
        let clamped = bounds.clamp_horizontal_position(Vec3::new(2.0, 12.0, 63.0), CHUNK_SIZE_I32);

        assert_eq!(clamped, Vec3::new(16.0, 12.0, 47.0));
    }

    #[test]
    fn loaded_air_is_distinct_from_missing_chunk() {
        let mut world = VoxelWorld::new(IVec3::new(1, 1, 1));
        world.insert_chunk(Chunk::new(IVec3::ZERO));
        let pos = IVec3::new(1, world.bounds().min_breakable_y, 1);

        assert_eq!(
            world.sample_voxel(pos),
            VoxelSample::InBounds(VoxelType::Air)
        );
    }

    #[test]
    fn voxel_edit_cannot_break_bedrock() {
        let mut world = VoxelWorld::new(IVec3::new(1, 1, 1));
        world.insert_chunk(Chunk::new(IVec3::ZERO));

        assert_eq!(
            world.set_voxel(IVec3::new(1, BEDROCK_DEPTH, 1), VoxelType::Air),
            VoxelEditResult::RejectedUnbreakable
        );
    }

    #[test]
    fn bedrock_crust_layers_are_virtual_and_unbreakable() {
        let mut world = VoxelWorld::new(IVec3::new(1, 1, 1));
        world.insert_chunk(Chunk::new(IVec3::ZERO));

        for y in 0..=BEDROCK_DEPTH {
            let pos = IVec3::new(1, y, 1);
            assert_eq!(
                world.sample_voxel(pos),
                VoxelSample::InBounds(VoxelType::Bedrock)
            );
            assert_eq!(
                world.set_voxel(pos, VoxelType::Air),
                VoxelEditResult::RejectedUnbreakable
            );
        }
    }

    #[test]
    fn voxel_edit_cannot_place_below_floor() {
        let mut world = VoxelWorld::new(IVec3::new(1, 1, 1));

        assert_eq!(
            world.set_voxel(IVec3::new(1, -1, 1), VoxelType::Rock),
            VoxelEditResult::RejectedBelowWorldFloor
        );
    }

    #[test]
    fn voxel_edit_cannot_dig_below_min_breakable_y() {
        let mut world = VoxelWorld::new(IVec3::new(1, 1, 1));
        world.insert_chunk(Chunk::new(IVec3::ZERO));

        assert!(world.bounds().min_breakable_y > BEDROCK_DEPTH);
        assert!(
            world
                .set_voxel(
                    IVec3::new(1, world.bounds().min_breakable_y - 1, 1),
                    VoxelType::Air
                )
                .rejected()
        );
    }

    #[test]
    fn voxel_edit_valid_above_floor_edits_work() {
        let mut world = VoxelWorld::new(IVec3::new(1, 1, 1));
        world.insert_chunk(Chunk::new(IVec3::ZERO));
        let pos = IVec3::new(1, world.bounds().min_breakable_y, 1);

        assert_eq!(
            world.set_voxel(pos, VoxelType::Rock),
            VoxelEditResult::Applied
        );
        assert_eq!(world.sample_voxel_raw(pos), Some(VoxelType::Rock));
        assert_eq!(
            world.set_voxel(pos, VoxelType::Air),
            VoxelEditResult::Applied
        );
        assert_eq!(world.sample_voxel_raw(pos), Some(VoxelType::Air));
    }

    #[test]
    fn dirty_chunk_membership_tracks_guarded_mutations() {
        let mut world = VoxelWorld::new(IVec3::new(1, 1, 1));
        world.insert_chunk(Chunk::new(IVec3::ZERO));

        assert_eq!(world.dirty_chunks().collect::<Vec<_>>(), vec![IVec3::ZERO]);
        assert_eq!(
            world.derived_dirty_chunks().collect::<Vec<_>>(),
            vec![IVec3::ZERO]
        );
        assert_eq!(world.take_derived_dirty_chunks(), vec![IVec3::ZERO]);
        assert_eq!(world.derived_dirty_chunks().count(), 0);

        world.get_chunk_mut(IVec3::ZERO).unwrap().clear_dirty();
        assert_eq!(world.dirty_chunks().count(), 0);
        assert_eq!(world.derived_dirty_chunks().count(), 0);

        world.mark_chunk_dirty_with_reason(IVec3::ZERO, MeshDirtyReason::Generation);
        assert_eq!(world.dirty_chunks().collect::<Vec<_>>(), vec![IVec3::ZERO]);
        assert_eq!(
            world.derived_dirty_chunks().collect::<Vec<_>>(),
            vec![IVec3::ZERO]
        );
    }

    #[test]
    fn voxel_edit_corner_does_not_mark_unrelated_diagonal_neighbor() {
        let mut world = VoxelWorld::new(IVec3::new(3, 3, 3));
        let center = IVec3::new(1, 1, 1);
        for dx in 0..3 {
            for dy in 0..3 {
                for dz in 0..3 {
                    world.insert_chunk(Chunk::new(IVec3::new(dx, dy, dz)));
                }
            }
        }
        let chunk_positions: Vec<IVec3> = world.chunk_positions().collect();
        for chunk_pos in chunk_positions {
            world.get_chunk_mut(chunk_pos).unwrap().clear_dirty();
        }

        let corner_world = VoxelWorld::chunk_to_world(center)
            + IVec3::new(CHUNK_SIZE_I32 - 1, CHUNK_SIZE_I32 - 1, CHUNK_SIZE_I32 - 1);
        assert_eq!(
            world.set_voxel(corner_world, VoxelType::Rock),
            VoxelEditResult::Applied
        );

        let unrelated = center + IVec3::new(1, 0, -1);
        assert!(
            world.get_chunk(unrelated).is_some(),
            "diagonal neighbor chunk should exist in fixture"
        );
        assert!(
            !world.get_chunk(unrelated).unwrap().is_dirty(),
            "edit on +X/+Y/+Z corner must not dirty unrelated -Z face neighbor"
        );
    }

    #[test]
    fn voxel_edit_legal_boundary_edit_marks_neighbor_chunk_dirty() {
        let mut world = VoxelWorld::new(IVec3::new(2, 1, 1));
        world.insert_chunk(Chunk::new(IVec3::ZERO));
        world.insert_chunk(Chunk::new(IVec3::X));
        for chunk_pos in [IVec3::ZERO, IVec3::X] {
            world.get_chunk_mut(chunk_pos).unwrap().clear_dirty();
        }

        assert_eq!(
            world.set_voxel(
                IVec3::new(CHUNK_SIZE_I32 - 1, world.bounds().min_breakable_y, 1),
                VoxelType::Rock
            ),
            VoxelEditResult::Applied
        );
        assert!(world.get_chunk(IVec3::ZERO).unwrap().is_dirty());
        assert!(world.get_chunk(IVec3::X).unwrap().is_dirty());
        let derived_dirty = world.derived_dirty_chunks().collect::<HashSet<_>>();
        assert!(derived_dirty.contains(&IVec3::ZERO));
        assert!(derived_dirty.contains(&IVec3::X));
    }
}
