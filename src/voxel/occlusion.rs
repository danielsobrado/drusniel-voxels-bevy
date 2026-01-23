//! Runtime occlusion culling using chunk face connectivity.
//!
//! Performs BFS traversal from the camera's chunk through the face visibility
//! graph to determine which chunks are potentially visible. Chunks that cannot
//! be reached through connected faces are occluded and can be culled.

use crate::camera::controller::PlayerCamera;
use crate::voxel::chunk::FaceVisibility;
use crate::voxel::skirt::ChunkFace;
use crate::voxel::world::VoxelWorld;
use bevy::prelude::*;
use std::collections::{HashSet, VecDeque};

/// Resource storing the set of potentially visible chunks from the camera.
#[derive(Resource, Default)]
pub struct VisibleChunks {
    /// Chunks that passed BFS visibility check.
    pub chunks: HashSet<IVec3>,
    /// Camera chunk position at last update.
    pub camera_chunk: IVec3,
    /// Whether visibility needs recalculation.
    pub dirty: bool,
}

impl VisibleChunks {
    /// Check if a chunk is potentially visible.
    #[inline]
    pub fn is_visible(&self, chunk_pos: IVec3) -> bool {
        self.chunks.contains(&chunk_pos)
    }

    /// Mark visibility as needing recalculation.
    pub fn mark_dirty(&mut self) {
        self.dirty = true;
    }
}

/// Configuration for occlusion culling.
#[derive(Resource)]
pub struct OcclusionConfig {
    /// Enable/disable occlusion culling.
    pub enabled: bool,
    /// Maximum BFS depth (limits computation per frame).
    pub max_depth: u32,
    /// How often to update visibility (in seconds).
    pub update_interval: f32,
}

impl Default for OcclusionConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            max_depth: 50, // Covers ~800 units at chunk size 16
            update_interval: 0.1, // 10Hz update
        }
    }
}

/// Entry in the BFS queue.
struct BfsEntry {
    chunk_pos: IVec3,
    /// Face we entered through (None for camera chunk).
    entry_face: Option<ChunkFace>,
    depth: u32,
}

/// Timer for throttling visibility updates.
#[derive(Resource, Default)]
pub struct OcclusionUpdateTimer {
    pub elapsed: f32,
}

/// Perform BFS from camera chunk to find all potentially visible chunks.
pub fn update_visible_chunks_system(
    world: Res<VoxelWorld>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    mut visible: ResMut<VisibleChunks>,
    config: Res<OcclusionConfig>,
    time: Res<Time>,
    mut timer: ResMut<OcclusionUpdateTimer>,
) {
    if !config.enabled {
        return;
    }

    // Throttle updates
    timer.elapsed += time.delta_secs();
    if timer.elapsed < config.update_interval && !visible.dirty {
        return;
    }
    timer.elapsed = 0.0;

    let Ok(camera_transform) = camera_query.single() else {
        return;
    };

    let camera_pos = camera_transform.translation;
    let camera_chunk = VoxelWorld::world_to_chunk(IVec3::new(
        camera_pos.x.floor() as i32,
        camera_pos.y.floor() as i32,
        camera_pos.z.floor() as i32,
    ));

    // Check if camera moved to different chunk
    if camera_chunk != visible.camera_chunk {
        visible.dirty = true;
        visible.camera_chunk = camera_chunk;
    }

    if !visible.dirty {
        return;
    }
    visible.dirty = false;

    // Perform BFS from camera chunk
    visible.chunks = bfs_visible_chunks(&world, camera_chunk, config.max_depth);
}

/// BFS traversal through chunk face connectivity graph.
fn bfs_visible_chunks(world: &VoxelWorld, start: IVec3, max_depth: u32) -> HashSet<IVec3> {
    let mut visited = HashSet::new();
    let mut queue = VecDeque::new();

    queue.push_back(BfsEntry {
        chunk_pos: start,
        entry_face: None,
        depth: 0,
    });

    while let Some(entry) = queue.pop_front() {
        if visited.contains(&entry.chunk_pos) {
            continue;
        }
        if entry.depth > max_depth {
            continue;
        }

        visited.insert(entry.chunk_pos);

        // Get chunk's face visibility
        let face_vis = match world.get_chunk(entry.chunk_pos) {
            Some(chunk) => chunk.face_visibility(),
            None => {
                // Non-existent chunks are treated as fully transparent
                // (allows seeing through unloaded areas)
                FaceVisibility::all_connected()
            }
        };

        // Try to propagate to neighbors through connected faces
        for (dir, exit_face, neighbor_entry_face) in NEIGHBOR_DIRECTIONS {
            let neighbor_pos = entry.chunk_pos + dir;

            if visited.contains(&neighbor_pos) {
                continue;
            }

            // Check if we can see through from entry face to exit face
            let can_propagate = match entry.entry_face {
                None => true, // Camera chunk - can exit through any face
                Some(entry_face) => face_vis.can_see_through(entry_face, exit_face),
            };

            if can_propagate {
                queue.push_back(BfsEntry {
                    chunk_pos: neighbor_pos,
                    entry_face: Some(neighbor_entry_face),
                    depth: entry.depth + 1,
                });
            }
        }
    }

    visited
}

/// Direction vector, exit face from current chunk, entry face into neighbor chunk.
const NEIGHBOR_DIRECTIONS: [(IVec3, ChunkFace, ChunkFace); 6] = [
    (IVec3::NEG_X, ChunkFace::NegX, ChunkFace::PosX),
    (IVec3::X, ChunkFace::PosX, ChunkFace::NegX),
    (IVec3::NEG_Y, ChunkFace::NegY, ChunkFace::PosY),
    (IVec3::Y, ChunkFace::PosY, ChunkFace::NegY),
    (IVec3::NEG_Z, ChunkFace::NegZ, ChunkFace::PosZ),
    (IVec3::Z, ChunkFace::PosZ, ChunkFace::NegZ),
];
