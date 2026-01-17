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
    // Only apply when left mouse is pressed
    if !mouse.pressed(MouseButton::Left) {
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

    match state.active_tool {
        TerrainTool::Raise => {
            // Raise: Add solid blocks above the surface
            for x in min_x..=max_x {
                for z in min_z..=max_z {
                    let pos = IVec3::new(x, 0, z);
                    let dist = Vec2::new(x as f32, z as f32).distance(center.xz());
                    if dist > radius {
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
                        // Add blocks above the surface based on strength and falloff
                        let falloff = 1.0 - (dist / radius).powi(2);
                        let raise_amount = (strength * falloff * 0.5).ceil() as i32;
                        
                        for dy in 1..=raise_amount {
                            let place_pos = IVec3::new(x, sy + dy, z);
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
        }
        TerrainTool::Lower => {
            // Lower: Remove solid blocks from the surface
            for x in min_x..=max_x {
                for z in min_z..=max_z {
                    let dist = Vec2::new(x as f32, z as f32).distance(center.xz());
                    if dist > radius {
                        continue;
                    }

                    // Find the surface height at this XZ position
                    for y in (min_y..max_y).rev() {
                        let check_pos = IVec3::new(x, y, z);
                        if let Some(voxel) = world.get_voxel(check_pos) {
                            if voxel.is_solid() && voxel != VoxelType::Bedrock {
                                let falloff = 1.0 - (dist / radius).powi(2);
                                let lower_amount = (strength * falloff * 0.5).ceil() as i32;
                                
                                // Remove blocks from top down
                                for dy in 0..lower_amount {
                                    let remove_pos = IVec3::new(x, y - dy, z);
                                    if let Some(existing) = world.get_voxel(remove_pos) {
                                        if existing.is_solid() && existing != VoxelType::Bedrock {
                                            world.set_voxel(remove_pos, VoxelType::Air);
                                            modified_positions.push(remove_pos);
                                        }
                                    }
                                }
                                break;
                            }
                        }
                    }
                }
            }
        }
        TerrainTool::Level => {
            // Level: Flatten terrain to the hit point height
            let target_height = center.y.floor() as i32;
            
            for x in min_x..=max_x {
                for z in min_z..=max_z {
                    let dist = Vec2::new(x as f32, z as f32).distance(center.xz());
                    if dist > radius {
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
                            // Need to raise: add blocks
                            for y in (sy + 1)..=target_height {
                                let place_pos = IVec3::new(x, y, z);
                                if let Some(existing) = world.get_voxel(place_pos) {
                                    if existing == VoxelType::Air {
                                        world.set_voxel(place_pos, VoxelType::TopSoil);
                                        modified_positions.push(place_pos);
                                    }
                                }
                            }
                        } else if sy > target_height {
                            // Need to lower: remove blocks
                            for y in (target_height + 1)..=sy {
                                let remove_pos = IVec3::new(x, y, z);
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
        }
        TerrainTool::Smooth => {
            // Smooth: Average heights in the radius
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

            // Second pass: adjust towards average
            for (x, current_y, z) in heights {
                let dist = Vec2::new(x as f32, z as f32).distance(center.xz());
                let falloff = 1.0 - (dist / radius).powi(2);
                let blend = (strength * falloff * 0.3).clamp(0.0, 1.0);
                
                let target_y = current_y + ((avg_height - current_y) as f32 * blend).round() as i32;

                if current_y < target_y {
                    // Raise
                    for y in (current_y + 1)..=target_y {
                        let place_pos = IVec3::new(x, y, z);
                        if let Some(existing) = world.get_voxel(place_pos) {
                            if existing == VoxelType::Air {
                                world.set_voxel(place_pos, VoxelType::TopSoil);
                                modified_positions.push(place_pos);
                            }
                        }
                    }
                } else if current_y > target_y {
                    // Lower
                    for y in (target_y + 1)..=current_y {
                        let remove_pos = IVec3::new(x, y, z);
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
        TerrainTool::None => {}
    }

    // Mark affected chunks as dirty for remeshing
    for pos in modified_positions {
        mark_neighbors_dirty(&mut world, pos);
    }
}
