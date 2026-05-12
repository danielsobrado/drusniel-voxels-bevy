use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use std::collections::HashMap;

use crate::constants::{CHUNK_SIZE_I32, CHUNK_SIZE_U32};
use crate::performance::{AreaTimingRecorder, area_timer};
use crate::physics::terrain_collider::TerrainCollisionRegistry;
use crate::player::Player;
use crate::voxel::meshing::ChunkMesh;
use crate::voxel::types::Voxel;
use crate::voxel::world::VoxelWorld;

const COLLISION_CACHE_HALO_RADIUS: i32 = 1;
const MAX_COLLISION_CACHE_REBUILDS_PER_FRAME: usize = 8;

#[derive(Clone, Debug)]
pub struct CollisionOccupancy {
    core_size: UVec3,
    halo_radius: i32,
    total_size: UVec3,
    occupied: Vec<u64>,
    occupied_core_cells: u32,
}

impl CollisionOccupancy {
    pub fn new(core_size: UVec3, halo_radius: i32) -> Self {
        debug_assert!(halo_radius >= 0);
        let halo = halo_radius as u32;
        let total_size = core_size + UVec3::splat(halo * 2);
        let bit_len = total_size.x as usize * total_size.y as usize * total_size.z as usize;
        let word_len = bit_len.div_ceil(64);
        Self {
            core_size,
            halo_radius,
            total_size,
            occupied: vec![0; word_len],
            occupied_core_cells: 0,
        }
    }

    pub fn core_size(&self) -> UVec3 {
        self.core_size
    }

    pub fn halo_radius(&self) -> i32 {
        self.halo_radius
    }

    pub fn occupied_core_cells(&self) -> u32 {
        self.occupied_core_cells
    }

    pub fn is_occupied_core(&self, local: UVec3) -> bool {
        if local.x >= self.core_size.x || local.y >= self.core_size.y || local.z >= self.core_size.z
        {
            return false;
        }
        let halo = self.halo_radius as u32;
        self.is_occupied_padded(local + UVec3::splat(halo))
    }

    pub fn is_occupied_halo_local(&self, local_with_halo: IVec3) -> bool {
        let padded = local_with_halo + IVec3::splat(self.halo_radius);
        if padded.x < 0 || padded.y < 0 || padded.z < 0 {
            return false;
        }
        self.is_occupied_padded(padded.as_uvec3())
    }

    pub fn filled_core_coords(&self) -> impl Iterator<Item = IVec3> + '_ {
        (0..self.core_size.z as i32).flat_map(move |z| {
            (0..self.core_size.y as i32).flat_map(move |y| {
                (0..self.core_size.x as i32).filter_map(move |x| {
                    let local = UVec3::new(x as u32, y as u32, z as u32);
                    self.is_occupied_core(local).then_some(IVec3::new(x, y, z))
                })
            })
        })
    }

    fn set_padded(&mut self, padded: UVec3, occupied: bool) {
        if padded.x >= self.total_size.x
            || padded.y >= self.total_size.y
            || padded.z >= self.total_size.z
        {
            return;
        }
        let bit = self.linear_index(padded);
        let word = bit / 64;
        let mask = 1u64 << (bit % 64);
        if occupied {
            self.occupied[word] |= mask;
        } else {
            self.occupied[word] &= !mask;
        }
    }

    fn is_occupied_padded(&self, padded: UVec3) -> bool {
        if padded.x >= self.total_size.x
            || padded.y >= self.total_size.y
            || padded.z >= self.total_size.z
        {
            return false;
        }
        let bit = self.linear_index(padded);
        let word = bit / 64;
        let mask = 1u64 << (bit % 64);
        (self.occupied[word] & mask) != 0
    }

    fn linear_index(&self, padded: UVec3) -> usize {
        padded.x as usize
            + padded.y as usize * self.total_size.x as usize
            + padded.z as usize * self.total_size.x as usize * self.total_size.y as usize
    }
}

#[derive(Clone, Debug)]
pub struct CollisionChunkCache {
    pub chunk: IVec3,
    pub source_revision: u64,
    pub occupancy: CollisionOccupancy,
    pub border_hashes: CollisionBorderHashes,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CollisionBorderHashes {
    pub neg_x: u64,
    pub pos_x: u64,
    pub neg_y: u64,
    pub pos_y: u64,
    pub neg_z: u64,
    pub pos_z: u64,
}

#[derive(Resource, Default)]
pub struct TerrainCollisionCache {
    chunks: HashMap<IVec3, CollisionChunkCache>,
}

impl TerrainCollisionCache {
    pub fn get(&self, chunk: IVec3) -> Option<&CollisionChunkCache> {
        self.chunks.get(&chunk)
    }

    pub fn len(&self) -> usize {
        self.chunks.len()
    }

    fn insert(&mut self, cache: CollisionChunkCache) {
        self.chunks.insert(cache.chunk, cache);
    }
}

pub fn build_collision_chunk_cache(
    world: &VoxelWorld,
    chunk: IVec3,
    source_revision: u64,
) -> CollisionChunkCache {
    let mut occupancy =
        CollisionOccupancy::new(UVec3::splat(CHUNK_SIZE_U32), COLLISION_CACHE_HALO_RADIUS);
    let chunk_origin = VoxelWorld::chunk_to_world(chunk);
    let halo = occupancy.halo_radius();

    for z in -halo..(CHUNK_SIZE_I32 + halo) {
        for y in -halo..(CHUNK_SIZE_I32 + halo) {
            for x in -halo..(CHUNK_SIZE_I32 + halo) {
                let world_pos = chunk_origin + IVec3::new(x, y, z);
                let occupied = world
                    .sample_voxel_for_collision(world_pos)
                    .collision_voxel()
                    .is_solid();
                let padded = UVec3::new((x + halo) as u32, (y + halo) as u32, (z + halo) as u32);
                occupancy.set_padded(padded, occupied);
                if occupied
                    && x >= 0
                    && y >= 0
                    && z >= 0
                    && x < CHUNK_SIZE_I32
                    && y < CHUNK_SIZE_I32
                    && z < CHUNK_SIZE_I32
                {
                    occupancy.occupied_core_cells += 1;
                }
            }
        }
    }

    let border_hashes = hash_borders(&occupancy);
    CollisionChunkCache {
        chunk,
        source_revision,
        occupancy,
        border_hashes,
    }
}

pub fn update_terrain_collision_cache(
    world: Res<VoxelWorld>,
    registry: Res<TerrainCollisionRegistry>,
    mut cache: ResMut<TerrainCollisionCache>,
    chunks: Query<&ChunkMesh>,
    player_query: Query<&Transform, With<Player>>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let (rebuilt, occupied_core_cells) = {
        let _timer = area_timer(&mut timing, frame.0, "Terrain Collision Cache Build");
        let priority_chunk = player_query
            .single()
            .ok()
            .map(|transform| VoxelWorld::world_to_chunk(transform.translation.floor().as_ivec3()));
        let mut candidates: Vec<IVec3> = chunks.iter().map(|chunk| chunk.chunk_position).collect();
        candidates.sort_by_key(|chunk| {
            priority_chunk
                .map(|priority| {
                    let delta = *chunk - priority;
                    delta.x.abs() + delta.y.abs() + delta.z.abs()
                })
                .unwrap_or(0)
        });

        let mut rebuilt = 0usize;
        let mut occupied_core_cells = 0u64;
        for chunk in candidates {
            if rebuilt >= MAX_COLLISION_CACHE_REBUILDS_PER_FRAME {
                break;
            }
            let source_revision = registry.source_revision(chunk);
            let needs_rebuild = cache
                .get(chunk)
                .map(|cached| cached.source_revision != source_revision)
                .unwrap_or(true);
            if !needs_rebuild {
                continue;
            }

            let chunk_cache = build_collision_chunk_cache(&world, chunk, source_revision);
            occupied_core_cells += chunk_cache.occupancy.occupied_core_cells() as u64;
            cache.insert(chunk_cache);
            rebuilt += 1;
        }
        (rebuilt, occupied_core_cells)
    };

    timing.record_count(
        frame.0,
        "Terrain Collision Cache Chunks",
        cache.len() as f64,
    );
    timing.record_count(frame.0, "Terrain Collision Cache Rebuilt", rebuilt as f64);
    timing.record_count(
        frame.0,
        "Terrain Collision Cache Occupied Core Cells Rebuilt",
        occupied_core_cells as f64,
    );
}

fn hash_borders(occupancy: &CollisionOccupancy) -> CollisionBorderHashes {
    let max = CHUNK_SIZE_I32 - 1;
    CollisionBorderHashes {
        neg_x: hash_face(occupancy, 0, Axis3::X),
        pos_x: hash_face(occupancy, max, Axis3::X),
        neg_y: hash_face(occupancy, 0, Axis3::Y),
        pos_y: hash_face(occupancy, max, Axis3::Y),
        neg_z: hash_face(occupancy, 0, Axis3::Z),
        pos_z: hash_face(occupancy, max, Axis3::Z),
    }
}

#[derive(Clone, Copy)]
enum Axis3 {
    X,
    Y,
    Z,
}

fn hash_face(occupancy: &CollisionOccupancy, fixed: i32, axis: Axis3) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for b in 0..CHUNK_SIZE_I32 {
        for a in 0..CHUNK_SIZE_I32 {
            let local = match axis {
                Axis3::X => IVec3::new(fixed, a, b),
                Axis3::Y => IVec3::new(a, fixed, b),
                Axis3::Z => IVec3::new(a, b, fixed),
            };
            let value = occupancy.is_occupied_halo_local(local) as u64;
            hash ^= value + 0x9e3779b97f4a7c15u64 + ((a as u64) << 6) + ((b as u64) << 12);
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voxel::chunk::Chunk;
    use crate::voxel::types::VoxelType;

    fn world_with_chunk(size: IVec3, chunk: IVec3) -> VoxelWorld {
        let mut world = VoxelWorld::new(size);
        world.insert_chunk(Chunk::new(chunk));
        world
    }

    #[test]
    fn occupancy_treats_missing_halo_chunk_as_solid() {
        let world = world_with_chunk(IVec3::new(2, 1, 1), IVec3::ZERO);
        let cache = build_collision_chunk_cache(&world, IVec3::ZERO, 1);

        assert!(
            cache
                .occupancy
                .is_occupied_halo_local(IVec3::new(CHUNK_SIZE_I32, 4, 4))
        );
    }

    #[test]
    fn occupancy_treats_water_as_empty_support() {
        let mut world = world_with_chunk(IVec3::new(1, 1, 1), IVec3::ZERO);
        assert!(
            world
                .set_voxel(IVec3::new(4, 8, 4), VoxelType::Water)
                .applied()
        );
        let cache = build_collision_chunk_cache(&world, IVec3::ZERO, 1);

        assert!(!cache.occupancy.is_occupied_core(UVec3::new(4, 8, 4)));
    }

    #[test]
    fn occupancy_keeps_bedrock_crust_solid() {
        let world = world_with_chunk(IVec3::new(1, 1, 1), IVec3::ZERO);
        let cache = build_collision_chunk_cache(&world, IVec3::ZERO, 1);

        assert!(cache.occupancy.is_occupied_core(UVec3::new(4, 0, 4)));
        assert!(cache.occupancy.is_occupied_core(UVec3::new(4, 3, 4)));
    }

    #[test]
    fn filled_core_coords_only_returns_core_cells() {
        let world = world_with_chunk(IVec3::new(1, 1, 1), IVec3::ZERO);
        let cache = build_collision_chunk_cache(&world, IVec3::ZERO, 1);

        assert!(cache.occupancy.filled_core_coords().all(|local| {
            local.x >= 0
                && local.y >= 0
                && local.z >= 0
                && local.x < CHUNK_SIZE_I32
                && local.y < CHUNK_SIZE_I32
                && local.z < CHUNK_SIZE_I32
        }));
    }
}
