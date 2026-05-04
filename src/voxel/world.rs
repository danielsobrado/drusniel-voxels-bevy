use crate::constants::{BEDROCK_DEPTH, CHUNK_SIZE_I32, MIN_BREAKABLE_Y, WORLD_KILL_Y};
use crate::terrain::generation::config::terrain_config_fingerprint;
use crate::voxel::chunk::Chunk;
use crate::voxel::persistence::WorldData;
use crate::voxel::types::VoxelType;
use crate::world_rules::{ProtectedAreaRegistry, ProtectedEditIntent};
use bevy::prelude::*;
use std::collections::HashMap;

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
            Self::OutsideAboveWorld => VoxelType::Air,
            Self::OutsideBelowWorld
            | Self::OutsideHorizontalWorld
            | Self::MissingChunkInsideBounds => VoxelType::Bedrock,
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
    world_size_chunks: IVec3,
    bounds: WorldBounds,
    edit_stats: VoxelEditStats,
}

impl VoxelWorld {
    pub fn new(size_chunks: IVec3) -> Self {
        Self {
            chunks: HashMap::new(),
            world_size_chunks: size_chunks,
            bounds: WorldBounds::from_size_chunks(size_chunks),
            edit_stats: VoxelEditStats::default(),
        }
    }

    // Chunk access
    pub fn get_chunk(&self, chunk_pos: IVec3) -> Option<&Chunk> {
        self.chunks.get(&chunk_pos)
    }

    pub fn get_chunk_mut(&mut self, chunk_pos: IVec3) -> Option<&mut Chunk> {
        self.chunks.get_mut(&chunk_pos)
    }

    pub fn chunk_exists(&self, chunk_pos: IVec3) -> bool {
        self.chunks.contains_key(&chunk_pos)
    }

    pub fn insert_chunk(&mut self, chunk: Chunk) {
        self.chunks.insert(chunk.position(), chunk);
    }

    // Voxel access (world coordinates)
    pub fn get_voxel(&self, world_pos: IVec3) -> Option<VoxelType> {
        self.sample_voxel_raw(world_pos)
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
        if protected_areas
            .map(|registry| registry.edit_blocked(world_pos, intent))
            .unwrap_or(false)
        {
            let result = VoxelEditResult::RejectedProtectedArea;
            self.edit_stats.record(result);
            return result;
        }

        self.set_voxel(world_pos, voxel)
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

        if let Some(chunk) = self.get_chunk_mut(chunk_pos) {
            let previous = chunk.get(local_pos);
            if previous == voxel {
                return VoxelEditResult::NoChange;
            }
            chunk.set(local_pos, voxel);
            for dz in -1..=1 {
                for dy in -1..=1 {
                    for dx in -1..=1 {
                        if dx == 0 && dy == 0 && dz == 0 {
                            continue;
                        }
                        let touches_neighbor = (dx < 0 && local_pos.x <= 1)
                            || (dx > 0 && local_pos.x >= (CHUNK_SIZE_I32 - 2) as u32)
                            || (dy < 0 && local_pos.y <= 1)
                            || (dy > 0 && local_pos.y >= (CHUNK_SIZE_I32 - 2) as u32)
                            || (dz < 0 && local_pos.z <= 1)
                            || (dz > 0 && local_pos.z >= (CHUNK_SIZE_I32 - 2) as u32);
                        if touches_neighbor {
                            if let Some(neighbor) =
                                self.get_chunk_mut(chunk_pos + IVec3::new(dx, dy, dz))
                            {
                                neighbor.mark_dirty_with_reason(
                                    crate::voxel::chunk::MeshDirtyReason::TerrainMutation,
                                );
                            }
                        }
                    }
                }
            }
            VoxelEditResult::Applied
        } else {
            VoxelEditResult::RejectedMissingChunk
        }
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
        self.chunks
            .iter()
            .filter(|(_, chunk)| chunk.is_dirty())
            .map(|(pos, _)| *pos)
    }

    pub fn chunk_entries_mut(&mut self) -> impl Iterator<Item = (&IVec3, &mut Chunk)> {
        self.chunks.iter_mut()
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
    fn missing_chunk_inside_bounds_is_not_air() {
        let world = VoxelWorld::new(IVec3::new(2, 1, 2));
        let pos = IVec3::new(CHUNK_SIZE_I32 + 1, 1, CHUNK_SIZE_I32 + 1);

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
    fn loaded_air_is_distinct_from_missing_chunk() {
        let mut world = VoxelWorld::new(IVec3::new(1, 1, 1));
        world.insert_chunk(Chunk::new(IVec3::ZERO));

        assert_eq!(
            world.sample_voxel(IVec3::new(1, 1, 1)),
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
    fn voxel_edit_cannot_place_below_floor() {
        let mut world = VoxelWorld::new(IVec3::new(1, 1, 1));

        assert_eq!(
            world.set_voxel(IVec3::new(1, BEDROCK_DEPTH - 1, 1), VoxelType::Rock),
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
    fn voxel_edit_legal_boundary_edit_marks_neighbor_chunk_dirty() {
        let mut world = VoxelWorld::new(IVec3::new(2, 1, 1));
        world.insert_chunk(Chunk::new(IVec3::ZERO));
        world.insert_chunk(Chunk::new(IVec3::X));
        for chunk_pos in [IVec3::ZERO, IVec3::X] {
            world.get_chunk_mut(chunk_pos).unwrap().clear_dirty();
        }

        assert_eq!(
            world.set_voxel(IVec3::new(CHUNK_SIZE_I32 - 1, 1, 1), VoxelType::Rock),
            VoxelEditResult::Applied
        );
        assert!(world.get_chunk(IVec3::ZERO).unwrap().is_dirty());
        assert!(world.get_chunk(IVec3::X).unwrap().is_dirty());
    }
}
