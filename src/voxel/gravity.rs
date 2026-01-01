use bevy::prelude::*;
use crate::voxel::world::VoxelWorld;
use crate::voxel::types::VoxelType;
use std::collections::{HashSet, VecDeque};

pub struct GravityPlugin;

impl Plugin for GravityPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Update, gravity_system);
    }
}

// Configuration for gravity system
const GRAVITY_UPDATE_INTERVAL: f32 = 0.05; // Run faster (20 times per second)
const MAX_SUPPORT_DISTANCE: u32 = 32; // Distance in blocks
const CHUNKS_PER_FRAME: usize = 16; // Process 16 chunks per tick (approx 320 chunks/sec)

#[derive(Resource)]
struct GravityState {
    timer: Timer,
    chunk_iterator_index: usize,
}

impl Default for GravityState {
    fn default() -> Self {
        Self {
            timer: Timer::from_seconds(GRAVITY_UPDATE_INTERVAL, TimerMode::Repeating),
            chunk_iterator_index: 0,
        }
    }
}

fn gravity_system(
    time: Res<Time>,
    mut world: ResMut<VoxelWorld>,
    mut state: Local<GravityState>,
) {
    state.timer.tick(time.delta());

    if !state.timer.is_finished() {
        return;
    }

    // Get all chunk positions
    let chunk_positions: Vec<IVec3> = world.all_chunk_positions().collect();
    if chunk_positions.is_empty() {
        return;
    }

    // Process a subset of chunks each frame
    let start_index = state.chunk_iterator_index % chunk_positions.len();
    let end_index = (start_index + CHUNKS_PER_FRAME).min(chunk_positions.len());
    
    // Update iterator for next frame
    state.chunk_iterator_index = (start_index + CHUNKS_PER_FRAME) % chunk_positions.len();

    // Collect updates first to avoid borrow checker issues
    // List of (position, new_voxel_type)
    let mut recursive_falls = Vec::new();

    for i in start_index..end_index {
        let chunk_pos = chunk_positions[i];
        
        // Skip if chunk doesn't exist (shouldn't happen with all_chunk_positions but safe is safe)
        if !world.chunk_exists(chunk_pos) {
            continue;
        }

        // We need to iterate over voxels in the chunk.
        // Since we can't easily iterate voxels from the world wrapper without positions,
        // we'll recalculate world positions for the chunk.
        let chunk_world_pos = VoxelWorld::chunk_to_world(chunk_pos);
        
        // Check voxels bottom-up to let lower things fall first? 
        // Or top-down? Top-down is better for "detaching", bottom-up is better for "landing".
        // Let's do bottom-up so if something falls, it falls into empty space.
        
        // Actually, for a sweeper, simply checking every voxel is expensive.
        // But let's try a naive optimization: only check non-air, non-bedrock voxels.
        
        // We will scan the chunk's voxels.
        // Note: accessing chunk directly would be faster but VoxelWorld abstractions are cleaner.
        // Let's rely on get_voxel/set_voxel for now.
        
        // Optimization: Iterating 16x16x16 = 4096 voxels * 4 chunks = 16k checks per 0.1s is fine.
        
        for y in 0..crate::constants::CHUNK_SIZE_I32 {
            for x in 0..crate::constants::CHUNK_SIZE_I32 {
                for z in 0..crate::constants::CHUNK_SIZE_I32 {
                    let local_pos = IVec3::new(x, y, z);
                    let world_pos = chunk_world_pos + local_pos;
                    
                    if let Some(voxel) = world.get_voxel(world_pos) {
                        if voxel == VoxelType::Air || voxel == VoxelType::Bedrock || voxel == VoxelType::Water {
                            continue;
                        }
                        
                        // Check if it should fall
                        if should_fall(&world, world_pos) {
                            // It should fall. 
                            // Check if space below is empty.
                            let below_pos = world_pos + IVec3::new(0, -1, 0);
                            
                            if let Some(below_voxel) = world.get_voxel(below_pos) {
                                if below_voxel == VoxelType::Air || below_voxel == VoxelType::Water {
                                     recursive_falls.push((world_pos, below_pos, voxel));
                                }
                            } else if below_pos.y < 0 {
                                // Destroy if it falls out of the world
                                recursive_falls.push((world_pos, below_pos, VoxelType::Air)); // Mark to remove source, but don't place destination
                            }
                        }
                    }
                }
            }
        }
    }

    // Apply updates
    for (source_pos, dest_pos, voxel_type) in recursive_falls {
        // Double check source is still what we think (in case of chain reactions in future)
         if let Some(current_source) = world.get_voxel(source_pos) {
             if current_source != voxel_type && voxel_type != VoxelType::Air {
                 continue; 
             }
         }
        
        // Move voxel
        world.set_voxel(source_pos, VoxelType::Air);
        
        // If destiny is within bounds/valid, set it
        if dest_pos.y >= 0 {
             // If falling into water, maybe splash? For now just replace.
            world.set_voxel(dest_pos, voxel_type);
        }
    }
}

fn should_fall(world: &VoxelWorld, pos: IVec3) -> bool {
    // Bedrock never falls
    if pos.y <= 0 {
        return false;
    }

    // 1. Check immediate support (optimization)
    // If voxel below is solid, we assume it's supporting us.
    // This creates a "layer-by-layer" falling effect for floating islands,
    // which is efficient and visually acceptable (like sand).
    let below = pos + IVec3::new(0, -1, 0);
    if let Some(below_voxel) = world.get_voxel(below) {
        if below_voxel == VoxelType::Bedrock {
            return false;
        }
        // If the thing below is solid, we don't fall yet.
        // We wait for the thing below to fall first (if it's unstable).
        // Exception: Leaves don't support things (usually).
        if below_voxel != VoxelType::Air && below_voxel != VoxelType::Water && below_voxel != VoxelType::Leaves {
             return false;
        }
    }

    // 2. BFS for support with Distance Tracking
    let mut queue = VecDeque::new();
    let mut visited = HashSet::new();
    
    // Push (position, distance)
    queue.push_back((pos, 0));
    visited.insert(pos);
    
    // Direct neighbors (6 directions)
    let directions = [
        IVec3::new(0, -1, 0), // Check down first
        IVec3::new(0, 1, 0),
        IVec3::new(-1, 0, 0),
        IVec3::new(1, 0, 0),
        IVec3::new(0, 0, -1),
        IVec3::new(0, 0, 1),
    ];

    while let Some((current, dist)) = queue.pop_front() {
        if dist > MAX_SUPPORT_DISTANCE {
            return true; // Too far from support, assume floating
        }

        for dir in directions.iter() {
            let next_pos = current + *dir;
            
            if visited.contains(&next_pos) {
                continue;
            }

            // Check boundaries - if we hit bottom of world, it's supported
            if next_pos.y <= 0 {
                return false; // Found support (ground)
            }

            if let Some(voxel) = world.get_voxel(next_pos) {
                if voxel == VoxelType::Bedrock {
                    return false; // Found support (bedrock)
                }
                
                // If voxel is solid, it can transmit support
                if voxel != VoxelType::Air && voxel != VoxelType::Water && voxel != VoxelType::Leaves { 
                     visited.insert(next_pos);
                     queue.push_back((next_pos, dist + 1));
                }
            }
        }
    }
    
    // BFS exhausted without finding support
    true
}
