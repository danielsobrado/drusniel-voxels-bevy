//! Chunk face visibility computation for occlusion culling.
//!
//! This module computes which pairs of chunk faces have line-of-sight through
//! the chunk's air voxels using a flood-fill algorithm. This data is used at
//! runtime to perform Minecraft-style BFS occlusion culling.

use crate::constants::{CHUNK_SIZE_I32, CHUNK_SIZE_U32, CHUNK_VOLUME};
use crate::voxel::chunk::{Chunk, ChunkUniformity, FaceVisibility};
use crate::voxel::skirt::ChunkFace;
use crate::voxel::types::VoxelType;
use bevy::prelude::*;
use std::collections::VecDeque;

/// Compute face visibility mask for a chunk using flood-fill.
///
/// Algorithm:
/// 1. For uniform chunks (empty/solid), return immediately
/// 2. For mixed chunks, flood-fill from each face through air voxels
/// 3. Track which other faces are reachable from each starting face
/// 4. Build the 15-bit connectivity mask
pub fn compute_face_visibility(chunk: &Chunk) -> FaceVisibility {
    // Quick paths for uniform chunks
    match chunk.uniformity() {
        ChunkUniformity::Empty => return FaceVisibility::all_connected(),
        ChunkUniformity::Solid => return FaceVisibility::none_connected(),
        ChunkUniformity::Unknown | ChunkUniformity::Mixed => {}
    }

    let mut visibility = FaceVisibility::none_connected();

    // Track which voxels have been visited globally to avoid redundant work
    let mut global_visited = [false; CHUNK_VOLUME];

    // For each face, flood-fill from air voxels on that face
    for &start_face in &ChunkFace::ALL {
        let face_positions = get_face_positions(start_face);

        for start_pos in face_positions {
            // Skip non-air voxels
            if chunk.get(start_pos) != VoxelType::Air {
                continue;
            }

            let start_idx = Chunk::index(
                start_pos.x as usize,
                start_pos.y as usize,
                start_pos.z as usize,
            );

            // Skip if already visited in a previous flood-fill
            if global_visited[start_idx] {
                continue;
            }

            // Flood-fill from this position and find reachable faces
            let reachable_faces = flood_fill_reachable_faces(chunk, start_pos, &mut global_visited);

            // Mark connectivity from start_face to all reachable faces
            for reached_face in reachable_faces {
                visibility.set_connected(start_face, reached_face, true);
            }
        }
    }

    visibility
}

/// Flood-fill through air voxels starting from `start`, returning which chunk
/// faces are reachable.
fn flood_fill_reachable_faces(
    chunk: &Chunk,
    start: UVec3,
    visited: &mut [bool; CHUNK_VOLUME],
) -> Vec<ChunkFace> {
    let mut reachable = Vec::with_capacity(6);
    let mut queue = VecDeque::with_capacity(256);

    queue.push_back(start);

    while let Some(pos) = queue.pop_front() {
        let idx = Chunk::index(pos.x as usize, pos.y as usize, pos.z as usize);

        if visited[idx] {
            continue;
        }
        visited[idx] = true;

        // Check which faces this voxel touches
        if pos.x == 0 && !reachable.contains(&ChunkFace::NegX) {
            reachable.push(ChunkFace::NegX);
        }
        if pos.x == CHUNK_SIZE_U32 - 1 && !reachable.contains(&ChunkFace::PosX) {
            reachable.push(ChunkFace::PosX);
        }
        if pos.y == 0 && !reachable.contains(&ChunkFace::NegY) {
            reachable.push(ChunkFace::NegY);
        }
        if pos.y == CHUNK_SIZE_U32 - 1 && !reachable.contains(&ChunkFace::PosY) {
            reachable.push(ChunkFace::PosY);
        }
        if pos.z == 0 && !reachable.contains(&ChunkFace::NegZ) {
            reachable.push(ChunkFace::NegZ);
        }
        if pos.z == CHUNK_SIZE_U32 - 1 && !reachable.contains(&ChunkFace::PosZ) {
            reachable.push(ChunkFace::PosZ);
        }

        // Early exit if all faces are reachable
        if reachable.len() == 6 {
            // Still need to mark remaining connected air as visited
            // to avoid redundant flood-fills, but we found all faces
        }

        // Expand to 6-connected neighbors
        for (dx, dy, dz) in [(-1, 0, 0), (1, 0, 0), (0, -1, 0), (0, 1, 0), (0, 0, -1), (0, 0, 1)] {
            let nx = pos.x as i32 + dx;
            let ny = pos.y as i32 + dy;
            let nz = pos.z as i32 + dz;

            // Bounds check
            if nx < 0 || nx >= CHUNK_SIZE_I32 || ny < 0 || ny >= CHUNK_SIZE_I32 || nz < 0 || nz >= CHUNK_SIZE_I32 {
                continue;
            }

            let neighbor = UVec3::new(nx as u32, ny as u32, nz as u32);
            let n_idx = Chunk::index(nx as usize, ny as usize, nz as usize);

            // Only expand through air voxels that haven't been visited
            if !visited[n_idx] && chunk.get(neighbor) == VoxelType::Air {
                queue.push_back(neighbor);
            }
        }
    }

    reachable
}

/// Returns iterator over all voxel positions on a chunk face.
fn get_face_positions(face: ChunkFace) -> impl Iterator<Item = UVec3> {
    let size = CHUNK_SIZE_U32;
    let last = size - 1;

    let (fixed_axis, fixed_value) = match face {
        ChunkFace::NegX => (0, 0),
        ChunkFace::PosX => (0, last),
        ChunkFace::NegY => (1, 0),
        ChunkFace::PosY => (1, last),
        ChunkFace::NegZ => (2, 0),
        ChunkFace::PosZ => (2, last),
    };

    (0..size).flat_map(move |a| {
        (0..size).map(move |b| match fixed_axis {
            0 => UVec3::new(fixed_value, a, b),
            1 => UVec3::new(a, fixed_value, b),
            _ => UVec3::new(a, b, fixed_value),
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_chunk_all_connected() {
        let mut chunk = Chunk::new(IVec3::ZERO);
        chunk.compute_uniformity();
        let vis = compute_face_visibility(&chunk);
        assert!(vis.is_fully_transparent());
    }

    #[test]
    fn test_solid_chunk_none_connected() {
        let mut chunk = Chunk::new(IVec3::ZERO);
        // Fill with solid voxels
        for x in 0..CHUNK_SIZE_U32 {
            for y in 0..CHUNK_SIZE_U32 {
                for z in 0..CHUNK_SIZE_U32 {
                    chunk.set(UVec3::new(x, y, z), VoxelType::Rock);
                }
            }
        }
        chunk.compute_uniformity();
        let vis = compute_face_visibility(&chunk);
        assert!(vis.is_fully_occluding());
    }

    #[test]
    fn test_tunnel_connects_faces() {
        let mut chunk = Chunk::new(IVec3::ZERO);
        // Fill with stone
        for x in 0..CHUNK_SIZE_U32 {
            for y in 0..CHUNK_SIZE_U32 {
                for z in 0..CHUNK_SIZE_U32 {
                    chunk.set(UVec3::new(x, y, z), VoxelType::Rock);
                }
            }
        }
        // Carve a tunnel from NegX to PosX at y=8, z=8
        for x in 0..CHUNK_SIZE_U32 {
            chunk.set(UVec3::new(x, 8, 8), VoxelType::Air);
        }
        chunk.compute_uniformity();
        let vis = compute_face_visibility(&chunk);
        // NegX and PosX should be connected
        assert!(vis.can_see_through(ChunkFace::NegX, ChunkFace::PosX));
        // But NegX and NegY should not (unless tunnel touches those faces)
        // This depends on exact tunnel position
    }
}
