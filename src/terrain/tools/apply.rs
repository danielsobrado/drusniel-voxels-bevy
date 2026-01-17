use bevy::prelude::*;
use super::types::{TerrainTool, TerrainToolState};
use super::preview::TerrainRaycastHit;
use crate::voxel::world::VoxelWorld;
use crate::voxel::types::{Voxel, VoxelType};
use crate::interaction::mark_neighbors_dirty;

/// System that applies terrain tools when mouse is clicked
pub fn apply_terrain_tool(
    mouse: Res<ButtonInput<MouseButton>>,
    state: Res<TerrainToolState>,
    hit: Option<Res<TerrainRaycastHit>>,
    mut world: ResMut<VoxelWorld>,
) {
    // Only apply on click (not held) for gradual control
    if !mouse.just_pressed(MouseButton::Left) {
        return;
    }

    // Must have an active tool
    if state.active_tool == TerrainTool::None {
        return;
    }

    // Must have a valid raycast hit
    let Some(hit) = hit else {
        return;
    };

    let center = hit.position;
    let radius = state.radius;
    let strength = state.strength;

    // Convert to integer bounds for voxel iteration
    let min_x = (center.x - radius).floor() as i32;
    let max_x = (center.x + radius).ceil() as i32;
    let min_y = (center.y - radius - 2.0).floor() as i32;
    let max_y = (center.y + radius + 2.0).ceil() as i32;
    let min_z = (center.z - radius).floor() as i32;
    let max_z = (center.z + radius).ceil() as i32;

    let mut modified_positions = Vec::new();
    
    // Simple pseudo-random based on position for sparse application
    let seed = (center.x * 1000.0 + center.z * 100.0) as u32;

    match state.active_tool {
        TerrainTool::Raise => {
            // Raise: Add ONE solid block above the surface (gradual)
            for x in min_x..=max_x {
                for z in min_z..=max_z {
                    let dist = Vec2::new(x as f32, z as f32).distance(center.xz());
                    if dist > radius {
                        continue;
                    }

                    // Falloff determines probability of affecting this column
                    let falloff = 1.0 - (dist / radius).powi(2);
                    let probability = falloff * strength * 0.5;
                    
                    // Use position-based pseudo-random to decide if we modify this column
                    let hash = ((x as u32).wrapping_mul(73856093) ^ (z as u32).wrapping_mul(19349663) ^ seed) % 1000;
                    if (hash as f32 / 1000.0) > probability {
                        continue;
                    }

                    // Find the surface height at this XZ position
                    let mut surface_y = None;
                    for y in (min_y..max_y).rev() {
                        let check_pos = IVec3::new(x, y, z);
                        if let Some(voxel) = world.get_voxel(check_pos) {
                            if voxel.is_solid() {
                                surface_y = Some(y);
                                break;
                            }
                        }
                    }

                    if let Some(sy) = surface_y {
                        // Add only ONE block above the surface per click
                        let place_pos = IVec3::new(x, sy + 1, z);
                        if let Some(existing) = world.get_voxel(place_pos) {
                            if existing == VoxelType::Air {
                                world.set_voxel(place_pos, VoxelType::TopSoil);
                                modified_positions.push(place_pos);
                            }
                        }
                    }
                }
            }
        }
        TerrainTool::Lower => {
            // Lower: Remove ONE solid block from the surface (gradual)
            for x in min_x..=max_x {
                for z in min_z..=max_z {
                    let dist = Vec2::new(x as f32, z as f32).distance(center.xz());
                    if dist > radius {
                        continue;
                    }

                    // Falloff determines probability of affecting this column
                    let falloff = 1.0 - (dist / radius).powi(2);
                    let probability = falloff * strength * 0.5;
                    
                    // Use position-based pseudo-random to decide if we modify this column
                    let hash = ((x as u32).wrapping_mul(73856093) ^ (z as u32).wrapping_mul(19349663) ^ seed) % 1000;
                    if (hash as f32 / 1000.0) > probability {
                        continue;
                    }

                    // Find the surface height at this XZ position and remove ONE block
                    for y in (min_y..max_y).rev() {
                        let check_pos = IVec3::new(x, y, z);
                        if let Some(voxel) = world.get_voxel(check_pos) {
                            if voxel.is_solid() && voxel != VoxelType::Bedrock {
                                world.set_voxel(check_pos, VoxelType::Air);
                                modified_positions.push(check_pos);
                                break;
                            }
                        }
                    }
                }
            }
        }
        TerrainTool::Level => {
            // Level: Flatten terrain to the hit point height (one block at a time)
            let target_height = center.y.floor() as i32;
            
            for x in min_x..=max_x {
                for z in min_z..=max_z {
                    let dist = Vec2::new(x as f32, z as f32).distance(center.xz());
                    if dist > radius {
                        continue;
                    }

                    // Falloff determines probability of affecting this column
                    let falloff = 1.0 - (dist / radius).powi(2);
                    let probability = falloff * strength * 0.5;
                    
                    // Use position-based pseudo-random to decide if we modify this column
                    let hash = ((x as u32).wrapping_mul(73856093) ^ (z as u32).wrapping_mul(19349663) ^ seed) % 1000;
                    if (hash as f32 / 1000.0) > probability {
                        continue;
                    }

                    // Find the current surface height
                    let mut surface_y = None;
                    for y in (min_y..max_y).rev() {
                        let check_pos = IVec3::new(x, y, z);
                        if let Some(voxel) = world.get_voxel(check_pos) {
                            if voxel.is_solid() {
                                surface_y = Some(y);
                                break;
                            }
                        }
                    }

                    if let Some(sy) = surface_y {
                        if sy < target_height {
                            // Need to raise: add ONE block
                            let place_pos = IVec3::new(x, sy + 1, z);
                            if let Some(existing) = world.get_voxel(place_pos) {
                                if existing == VoxelType::Air {
                                    world.set_voxel(place_pos, VoxelType::TopSoil);
                                    modified_positions.push(place_pos);
                                }
                            }
                        } else if sy > target_height {
                            // Need to lower: remove ONE block
                            let remove_pos = IVec3::new(x, sy, z);
                            if let Some(existing) = world.get_voxel(remove_pos) {
                                if existing.is_solid() && existing != VoxelType::Bedrock {
                                    world.set_voxel(remove_pos, VoxelType::Air);
                                    modified_positions.push(remove_pos);
                                }
                            }
                        }
                    }
                }
            }
        }
        TerrainTool::Smooth => {
            // Smooth: Average heights in the radius (one block at a time)
            // First pass: calculate average height
            let mut heights: Vec<(i32, i32, i32)> = Vec::new();
            
            for x in min_x..=max_x {
                for z in min_z..=max_z {
                    let dist = Vec2::new(x as f32, z as f32).distance(center.xz());
                    if dist > radius {
                        continue;
                    }

                    for y in (min_y..max_y).rev() {
                        let check_pos = IVec3::new(x, y, z);
                        if let Some(voxel) = world.get_voxel(check_pos) {
                            if voxel.is_solid() {
                                heights.push((x, y, z));
                                break;
                            }
                        }
                    }
                }
            }

            if heights.is_empty() {
                return;
            }

            let avg_height: i32 = heights.iter().map(|(_, y, _)| *y).sum::<i32>() / heights.len() as i32;

            // Second pass: adjust ONE block towards average with probability
            for (x, current_y, z) in heights {
                let dist = Vec2::new(x as f32, z as f32).distance(center.xz());
                let falloff = 1.0 - (dist / radius).powi(2);
                let probability = falloff * strength * 0.3;
                
                // Use position-based pseudo-random to decide if we modify this column
                let hash = ((x as u32).wrapping_mul(73856093) ^ (z as u32).wrapping_mul(19349663) ^ seed) % 1000;
                if (hash as f32 / 1000.0) > probability {
                    continue;
                }

                if current_y < avg_height {
                    // Raise: add ONE block
                    let place_pos = IVec3::new(x, current_y + 1, z);
                    if let Some(existing) = world.get_voxel(place_pos) {
                        if existing == VoxelType::Air {
                            world.set_voxel(place_pos, VoxelType::TopSoil);
                            modified_positions.push(place_pos);
                        }
                    }
                } else if current_y > avg_height {
                    // Lower: remove ONE block
                    let remove_pos = IVec3::new(x, current_y, z);
                    if let Some(existing) = world.get_voxel(remove_pos) {
                        if existing.is_solid() && existing != VoxelType::Bedrock {
                            world.set_voxel(remove_pos, VoxelType::Air);
                            modified_positions.push(remove_pos);
                        }
                    }
                }
            }
        }
        TerrainTool::None => {}
    }

    // Mark affected chunks as dirty for remeshing
    for pos in modified_positions {
        mark_neighbors_dirty(&mut world, pos);
    }
}
