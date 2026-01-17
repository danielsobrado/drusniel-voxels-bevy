use crate::constants::CHUNK_SIZE_I32;
use crate::voxel::chunk::Chunk;
use crate::voxel::persistence::WorldData;
use crate::voxel::types::VoxelType;
use bevy::prelude::*;
use std::collections::HashMap;

#[derive(Resource)]
pub struct VoxelWorld {
    chunks: HashMap<IVec3, Chunk>,
    world_size_chunks: IVec3,
}

impl VoxelWorld {
    pub fn new(size_chunks: IVec3) -> Self {
        Self {
            chunks: HashMap::new(),
            world_size_chunks: size_chunks,
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
        let chunk_pos = Self::world_to_chunk(world_pos);
        let local_pos = Self::world_to_local(world_pos);
        self.get_chunk(chunk_pos).map(|chunk| chunk.get(local_pos))
    }

    pub fn set_voxel(&mut self, world_pos: IVec3, voxel: VoxelType) -> bool {
        let chunk_pos = Self::world_to_chunk(world_pos);
        let local_pos = Self::world_to_local(world_pos);

        if let Some(chunk) = self.get_chunk_mut(chunk_pos) {
            chunk.set(local_pos, voxel);
            true
        } else {
            false
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
        let chunk_pos = Self::world_to_chunk(world_pos);
        self.chunk_in_bounds(chunk_pos)
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

    /// Convert world to serializable data
    pub fn to_data(&self) -> WorldData {
        WorldData {
            world_size_chunks: self.world_size_chunks,
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
