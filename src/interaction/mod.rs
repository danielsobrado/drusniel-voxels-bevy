//! Block and entity interaction systems.
//!
//! This module provides player interaction with the voxel world including:
//! - Block targeting and raycasting
//! - Block breaking and placing
//! - Edit mode (drag & drop blocks)
//! - Entity targeting and attacking
//! - Debug overlays

use crate::constants::{INTERACTION_RANGE, RAY_STEP, ENTITY_TARGET_CONE, ENTITY_TARGET_RADIUS, ATTACK_DAMAGE};
use crate::entity::{Health, Wolf};
use crate::interaction::palette::{PlacementPaletteState, PlacementSelection};
use crate::menu::PauseMenuState;
use crate::network::NetworkSession;
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::VoxelWorld;
use crate::particles::{SpawnParticleEvent, ParticleType};
use bevy::diagnostic::{DiagnosticsStore, FrameTimeDiagnosticsPlugin};
use bevy::input::mouse::MouseWheel;
use bevy::prelude::*;

pub mod palette;
// Note: targeting, editing, and debug modules are available for future refactoring
// pub mod targeting;
// pub mod editing;
// pub mod debug;

/// Component to mark the block highlight entity
#[derive(Component)]
pub struct BlockHighlight;

/// Component to mark the debug overlay text
#[derive(Component)]
pub struct DebugOverlay;

/// Resource to track debug overlay visibility
#[derive(Resource)]
pub struct DebugOverlayState {
    pub visible: bool,
}

impl Default for DebugOverlayState {
    fn default() -> Self {
        Self { visible: false }
    }
}

/// Toggles for optional debug details to keep the overlay decluttered
#[derive(Resource, Default)]
pub struct DebugDetailToggles {
    pub show_vertex_corners: bool,
    pub show_texture_details: bool,
    pub show_multiplayer: bool,
}

/// Resource tracking the currently targeted block
#[derive(Resource, Default)]
pub struct TargetedBlock {
    pub position: Option<IVec3>,
    pub normal: Option<IVec3>,
    pub voxel_type: Option<VoxelType>,
}

/// Resource that enables the edition mode for dragging blocks
#[derive(Resource, Default)]
pub struct EditMode {
    pub enabled: bool,
}

/// Resource to track delete mode while editing
#[derive(Resource, Default)]
pub struct DeleteMode {
    pub enabled: bool,
}

/// State for an in-progress drag operation
#[derive(Resource, Default)]
pub struct DragState {
    pub dragged_block: Option<DraggedBlock>,
    pub rotation_degrees: f32,
}

pub struct DraggedBlock {
    pub block_type: VoxelType,
    pub original_position: IVec3,
}

/// Resource tracking the currently targeted entity
#[derive(Resource, Default)]
pub struct TargetedEntity {
    pub entity: Option<Entity>,
    pub distance: f32,
}

/// Resource for the player's held block type
#[derive(Resource)]
pub struct HeldBlock {
    pub block_type: VoxelType,
}

impl Default for HeldBlock {
    fn default() -> Self {
        Self {
            block_type: VoxelType::Rock,
        }
    }
}


/// Cast a ray and find the first solid block hit
pub fn raycast_blocks(
    origin: Vec3,
    direction: Vec3,
    world: &VoxelWorld,
    max_distance: f32,
) -> Option<(IVec3, IVec3)> {
    let mut pos = origin;
    let step = direction.normalize() * RAY_STEP;
    let mut prev_block = IVec3::new(
        pos.x.floor() as i32,
        pos.y.floor() as i32,
        pos.z.floor() as i32,
    );

    let steps = (max_distance / RAY_STEP) as i32;

    for _ in 0..steps {
        pos += step;
        let block_pos = IVec3::new(
            pos.x.floor() as i32,
            pos.y.floor() as i32,
            pos.z.floor() as i32,
        );

        if block_pos != prev_block {
            if let Some(voxel) = world.get_voxel(block_pos) {
                if voxel.is_solid() {
                    // Calculate which face we hit based on direction
                    let normal = prev_block - block_pos;
                    return Some((block_pos, normal));
                }
            }
            prev_block = block_pos;
        }
    }

    None
}

/// System to update the targeted block based on camera look direction
pub fn update_targeted_block(
    camera_query: Query<&Transform, With<crate::camera::controller::PlayerCamera>>,
    world: Res<VoxelWorld>,
    mut targeted: ResMut<TargetedBlock>,
) {
    if let Ok(transform) = camera_query.single() {
        let origin = transform.translation;
        let direction = transform.forward().as_vec3();

        if let Some((block_pos, normal)) =
            raycast_blocks(origin, direction, &world, INTERACTION_RANGE)
        {
            targeted.position = Some(block_pos);
            targeted.normal = Some(normal);
            targeted.voxel_type = world.get_voxel(block_pos);
        } else {
            targeted.position = None;
            targeted.normal = None;
            targeted.voxel_type = None;
        }
    }
}

/// System to update the targeted entity based on camera look direction
pub fn update_targeted_entity(
    camera_query: Query<&Transform, With<crate::camera::controller::PlayerCamera>>,
    entity_query: Query<(Entity, &Transform), With<Wolf>>,
    mut targeted: ResMut<TargetedEntity>,
) {
    targeted.entity = None;
    targeted.distance = f32::MAX;

    if let Ok(camera_transform) = camera_query.single() {
        let origin = camera_transform.translation;
        let direction = camera_transform.forward().as_vec3();

        // Check all entities for intersection
        for (entity, entity_transform) in entity_query.iter() {
            let to_entity = entity_transform.translation - origin;
            let distance = to_entity.length();

            // Skip if too far
            if distance > INTERACTION_RANGE {
                continue;
            }

            // Check if entity is in front of camera (within targeting cone)
            let dot = to_entity.normalize().dot(direction);
            if dot < ENTITY_TARGET_CONE {
                continue;
            }

            // Simple sphere collision
            let closest_point = origin + direction * dot * distance;
            let dist_to_ray = (entity_transform.translation - closest_point).length();

            if dist_to_ray < ENTITY_TARGET_RADIUS && distance < targeted.distance {
                targeted.entity = Some(entity);
                targeted.distance = distance;
            }
        }
    }
}

/// System to handle attacking entities (left click)
pub fn attack_entity_system(
    mouse: Res<ButtonInput<MouseButton>>,
    edit_mode: Res<EditMode>,
    targeted_entity: Res<TargetedEntity>,
    mut entity_query: Query<&mut Health>,
) {
    if edit_mode.enabled {
        return;
    }

    if mouse.just_pressed(MouseButton::Left) {
        if let Some(entity) = targeted_entity.entity {
            if let Ok(mut health) = entity_query.get_mut(entity) {
                health.damage(ATTACK_DAMAGE);
                info!("Attacked entity! Health: {}/{}", health.current, health.max);
            }
        }
    }
}

/// System to handle block breaking (left click)
pub fn break_block_system(
    mouse: Res<ButtonInput<MouseButton>>,
    edit_mode: Res<EditMode>,
    targeted_block: Res<TargetedBlock>,
    targeted_entity: Res<TargetedEntity>,
    mut world: ResMut<VoxelWorld>,
    mut held: ResMut<HeldBlock>,
    mut particle_events: MessageWriter<SpawnParticleEvent>,
) {
    if edit_mode.enabled {
        return;
    }

    // Only break blocks if not targeting an entity
    if mouse.just_pressed(MouseButton::Left) && targeted_entity.entity.is_none() {
        if let (Some(pos), Some(voxel_type)) = (targeted_block.position, targeted_block.voxel_type)
        {
            // Don't break bedrock
            if voxel_type != VoxelType::Bedrock {
                // Store the broken block type for placing
                held.block_type = voxel_type;

                // Set to air
                world.set_voxel(pos, VoxelType::Air);

                // Mark neighboring chunks dirty too (for proper mesh updates at edges)
                mark_neighbors_dirty(&mut world, pos);

                // Spawn digging particles
                let center = Vec3::new(pos.x as f32 + 0.5, pos.y as f32 + 0.5, pos.z as f32 + 0.5);
                particle_events.write(SpawnParticleEvent {
                    position: center,
                    particle_type: ParticleType::Dig,
                });
            }
        }
    }
}

/// System to handle block placing (right click)
pub fn place_block_system(
    mouse: Res<ButtonInput<MouseButton>>,
    edit_mode: Res<EditMode>,
    delete_mode: Res<DeleteMode>,
    targeted: Res<TargetedBlock>,
    mut world: ResMut<VoxelWorld>,
    held: Res<HeldBlock>,
    camera_query: Query<&Transform, With<crate::camera::controller::PlayerCamera>>,
    drag_state: Res<DragState>,
    palette: Res<PlacementPaletteState>,
) {
    let placing_in_edit_mode = edit_mode.enabled
        && palette
            .active_selection
            .as_ref()
            .map(|selection| matches!(selection, PlacementSelection::Voxel(_)))
            .unwrap_or(false);

    if edit_mode.enabled && !placing_in_edit_mode {
        return;
    }

    if delete_mode.enabled || drag_state.dragged_block.is_some() {
        return;
    }

    if mouse.just_pressed(MouseButton::Right) {
        if let (Some(block_pos), Some(normal)) = (targeted.position, targeted.normal) {
            // Place block on the face we're looking at
            let place_pos = block_pos + normal;

            // Don't place if player is standing there
            if let Ok(camera_transform) = camera_query.single() {
                let player_pos = camera_transform.translation;
                let player_block = IVec3::new(
                    player_pos.x.floor() as i32,
                    player_pos.y.floor() as i32,
                    player_pos.z.floor() as i32,
                );
                let player_feet = IVec3::new(
                    player_pos.x.floor() as i32,
                    (player_pos.y - 1.8).floor() as i32,
                    player_pos.z.floor() as i32,
                );

                if place_pos == player_block || place_pos == player_feet {
                    return; // Can't place block where player is standing
                }
            }

            // Check if the position is valid (air or water)
            if let Some(existing) = world.get_voxel(place_pos) {
                if existing == VoxelType::Air || existing == VoxelType::Water {
                    world.set_voxel(place_pos, held.block_type);
                    mark_neighbors_dirty(&mut world, place_pos);
                }
            }
        }
    }
}

/// Mark a block and its neighbors as dirty for mesh regeneration
fn mark_neighbors_dirty(world: &mut VoxelWorld, pos: IVec3) {
    // Mark the chunk containing this block
    let chunk_pos = VoxelWorld::world_to_chunk(pos);
    if let Some(chunk) = world.get_chunk_mut(chunk_pos) {
        chunk.mark_dirty();
    }

    // Check if we're at a chunk boundary and mark neighbor chunks
    let local = VoxelWorld::world_to_local(pos);

    let offsets = [
        (local.x == 0, IVec3::new(-1, 0, 0)),
        (local.x == 15, IVec3::new(1, 0, 0)),
        (local.y == 0, IVec3::new(0, -1, 0)),
        (local.y == 15, IVec3::new(0, 1, 0)),
        (local.z == 0, IVec3::new(0, 0, -1)),
        (local.z == 15, IVec3::new(0, 0, 1)),
    ];

    for (at_edge, offset) in offsets {
        if at_edge {
            let neighbor_chunk = chunk_pos + offset;
            if let Some(chunk) = world.get_chunk_mut(neighbor_chunk) {
                chunk.mark_dirty();
            }
        }
    }
}

/// Toggle edit mode with Shift+M and restore any dragged block when disabling it
pub fn toggle_edit_mode(
    keyboard: Res<ButtonInput<KeyCode>>,
    mut edit_mode: ResMut<EditMode>,
    mut delete_mode: ResMut<DeleteMode>,
    mut drag_state: ResMut<DragState>,
    mut world: ResMut<VoxelWorld>,
) {
    let shift_pressed =
        keyboard.pressed(KeyCode::ShiftLeft) || keyboard.pressed(KeyCode::ShiftRight);

    if keyboard.just_pressed(KeyCode::KeyM) && shift_pressed {
        edit_mode.enabled = !edit_mode.enabled;
        delete_mode.enabled = false;

        if edit_mode.enabled {
            info!("Edit mode enabled - click and drag a block to move it");
        } else {
            if let Some(dragged) = drag_state.dragged_block.take() {
                world.set_voxel(dragged.original_position, dragged.block_type);
                mark_neighbors_dirty(&mut world, dragged.original_position);
            }
            drag_state.rotation_degrees = 0.0;
            info!("Edit mode disabled");
        }
    }
}

/// Toggle delete mode with the Delete key when edit mode is enabled
pub fn toggle_delete_mode(
    keyboard: Res<ButtonInput<KeyCode>>,
    edit_mode: Res<EditMode>,
    mut delete_mode: ResMut<DeleteMode>,
    mut drag_state: ResMut<DragState>,
    mut world: ResMut<VoxelWorld>,
) {
    if !edit_mode.enabled {
        delete_mode.enabled = false;
        return;
    }

    if keyboard.just_pressed(KeyCode::Delete) {
        delete_mode.enabled = !delete_mode.enabled;

        if delete_mode.enabled {
            if let Some(dragged) = drag_state.dragged_block.take() {
                world.set_voxel(dragged.original_position, dragged.block_type);
                mark_neighbors_dirty(&mut world, dragged.original_position);
            }
            drag_state.rotation_degrees = 0.0;
            info!("Delete mode enabled - left click a block to remove it");
        } else {
            info!("Delete mode disabled");
        }
    }
}

/// Begin dragging the currently targeted block when in edit mode
pub fn start_dragging_block(
    edit_mode: Res<EditMode>,
    delete_mode: Res<DeleteMode>,
    mouse: Res<ButtonInput<MouseButton>>,
    targeted_block: Res<TargetedBlock>,
    mut drag_state: ResMut<DragState>,
    mut world: ResMut<VoxelWorld>,
) {
    if !edit_mode.enabled || delete_mode.enabled || !mouse.just_pressed(MouseButton::Left) {
        return;
    }

    if drag_state.dragged_block.is_some() {
        return;
    }

    if let (Some(pos), Some(voxel_type)) = (targeted_block.position, targeted_block.voxel_type) {
        if voxel_type == VoxelType::Bedrock {
            return;
        }

        world.set_voxel(pos, VoxelType::Air);
        mark_neighbors_dirty(&mut world, pos);
        drag_state.dragged_block = Some(DraggedBlock {
            block_type: voxel_type,
            original_position: pos,
        });
        drag_state.rotation_degrees = 0.0;
    }
}

/// Finish dragging by placing the block at the targeted location, or restore it if invalid
pub fn finish_dragging_block(
    edit_mode: Res<EditMode>,
    mouse: Res<ButtonInput<MouseButton>>,
    targeted_block: Res<TargetedBlock>,
    mut drag_state: ResMut<DragState>,
    camera_query: Query<&Transform, With<crate::camera::controller::PlayerCamera>>,
    mut world: ResMut<VoxelWorld>,
) {
    if !edit_mode.enabled || !mouse.just_released(MouseButton::Left) {
        return;
    }

    let Some(dragged) = drag_state.dragged_block.take() else {
        return;
    };

    if let (Some(block_pos), Some(normal)) = (targeted_block.position, targeted_block.normal) {
        let place_pos = block_pos + normal;
        let Some(grounded_pos) = find_grounded_position(place_pos, &world) else {
            world.set_voxel(dragged.original_position, dragged.block_type);
            mark_neighbors_dirty(&mut world, dragged.original_position);
            return;
        };

        if let Ok(camera_transform) = camera_query.single() {
            let player_block = IVec3::new(
                camera_transform.translation.x.floor() as i32,
                camera_transform.translation.y.floor() as i32,
                camera_transform.translation.z.floor() as i32,
            );
            let player_feet = IVec3::new(
                camera_transform.translation.x.floor() as i32,
                (camera_transform.translation.y - 1.8).floor() as i32,
                camera_transform.translation.z.floor() as i32,
            );

            if grounded_pos == player_block || grounded_pos == player_feet {
                world.set_voxel(dragged.original_position, dragged.block_type);
                mark_neighbors_dirty(&mut world, dragged.original_position);
                return;
            }
        }

        if let Some(existing) = world.get_voxel(grounded_pos) {
            if existing == VoxelType::Air || existing == VoxelType::Water {
                world.set_voxel(grounded_pos, dragged.block_type);
                mark_neighbors_dirty(&mut world, grounded_pos);
                return;
            }
        }
    }

    // Restore to the original position if we couldn't place it elsewhere
    world.set_voxel(dragged.original_position, dragged.block_type);
    mark_neighbors_dirty(&mut world, dragged.original_position);
    drag_state.rotation_degrees = 0.0;
}

/// Adjust the dragged block rotation using the scroll wheel or Q/E keys
pub fn update_drag_rotation(
    edit_mode: Res<EditMode>,
    delete_mode: Res<DeleteMode>,
    mut drag_state: ResMut<DragState>,
    mut mouse_wheel: MessageReader<MouseWheel>,
    keyboard: Res<ButtonInput<KeyCode>>,
) {
    if !edit_mode.enabled || delete_mode.enabled {
        return;
    }

    if drag_state.dragged_block.is_none() {
        drag_state.rotation_degrees = 0.0;
        return;
    }

    let mut rotation_delta: f32 = 0.0;

    for wheel in mouse_wheel.read() {
        rotation_delta += wheel.y * 15.0;
    }

    if keyboard.just_pressed(KeyCode::KeyQ) {
        rotation_delta -= 90.0;
    }

    if keyboard.just_pressed(KeyCode::KeyE) {
        rotation_delta += 90.0;
    }

    if rotation_delta.abs() > f32::EPSILON {
        drag_state.rotation_degrees = (drag_state.rotation_degrees + rotation_delta) % 360.0;

        if drag_state.rotation_degrees < 0.0 {
            drag_state.rotation_degrees += 360.0;
        }
    }
}

/// Delete the targeted block when delete mode is active
pub fn delete_block_in_edit_mode(
    edit_mode: Res<EditMode>,
    delete_mode: Res<DeleteMode>,
    mouse: Res<ButtonInput<MouseButton>>,
    targeted_block: Res<TargetedBlock>,
    mut world: ResMut<VoxelWorld>,
) {
    if !edit_mode.enabled || !delete_mode.enabled {
        return;
    }

    if mouse.just_pressed(MouseButton::Left) {
        if let (Some(pos), Some(voxel_type)) = (targeted_block.position, targeted_block.voxel_type)
        {
            if voxel_type != VoxelType::Bedrock {
                world.set_voxel(pos, VoxelType::Air);
                mark_neighbors_dirty(&mut world, pos);
            }
        }
    }
}

/// Given a desired placement coordinate, drop it to the nearest supported position
fn find_grounded_position(start: IVec3, world: &VoxelWorld) -> Option<IVec3> {
    if !world.in_bounds(start) {
        return None;
    }

    let mut pos = start;

    // Cannot place inside a solid block
    match world.get_voxel(pos) {
        Some(voxel) if voxel.is_solid() => return None,
        Some(_) => {}
        None => return None,
    }

    // Slide downward until we find solid ground
    loop {
        let below = pos + IVec3::NEG_Y;

        if !world.in_bounds(below) {
            return None;
        }

        match world.get_voxel(below) {
            Some(voxel) if voxel.is_solid() => return Some(pos),
            Some(_) => pos = below,
            None => return None,
        }
    }
}

/// System to render block highlight wireframe
pub fn render_block_highlight(
    targeted: Res<TargetedBlock>,
    drag_state: Res<DragState>,
    edit_mode: Res<EditMode>,
    world: Res<VoxelWorld>,
    mut gizmos: Gizmos,
) {
    if let Some(pos) = targeted.position {
        let center = Vec3::new(pos.x as f32 + 0.5, pos.y as f32 + 0.5, pos.z as f32 + 0.5);
        let half_size = Vec3::splat(0.505); // Slightly larger than block

        // Draw wireframe cube
        gizmos.cuboid(
            Transform::from_translation(center).with_scale(half_size * 2.0),
            Color::srgba(1.0, 1.0, 1.0, 0.8),
        );

        // Draw a placement arrow when dragging in edit mode
        if edit_mode.enabled && drag_state.dragged_block.is_some() {
            if let Some(normal) = targeted.normal {
                let desired = pos + normal;
                if let Some(grounded) = find_grounded_position(desired, &world) {
                    let placement_center = Vec3::new(
                        grounded.x as f32 + 0.5,
                        grounded.y as f32 + 0.5,
                        grounded.z as f32 + 0.5,
                    );
                    let rotation = Quat::from_rotation_y(drag_state.rotation_degrees.to_radians());
                    let forward = rotation * Vec3::Z;
                    gizmos.arrow(
                        placement_center,
                        placement_center + forward * 0.75,
                        Color::srgb(1.0, 0.27, 0.0),
                    );
                }
            }
        }
    }
}

/// System to debug voxel info when G is pressed
pub fn debug_voxel_info_system(
    keyboard: Res<ButtonInput<KeyCode>>,
    targeted: Res<TargetedBlock>,
    world: Res<VoxelWorld>,
    camera_query: Query<&Transform, With<crate::camera::controller::PlayerCamera>>,
) {
    if keyboard.just_pressed(KeyCode::KeyG) {
        info!("╔══════════════════════════════════════════════════════════════╗");
        info!("║              DETAILED BLOCK DEBUG INFO [G]                   ║");
        info!("╚══════════════════════════════════════════════════════════════╝");

        // Camera position
        if let Ok(camera) = camera_query.single() {
            let pos = camera.translation;
            info!("Camera: ({:.2}, {:.2}, {:.2})", pos.x, pos.y, pos.z);
        }

        // Targeted block info
        if let (Some(pos), Some(voxel_type)) = (targeted.position, targeted.voxel_type) {
            let chunk_pos = VoxelWorld::world_to_chunk(pos);
            let local_pos = VoxelWorld::world_to_local(pos);

            info!("┌─────────────────────────────────────────────────────────────┐");
            info!("│ TARGETED BLOCK                                              │");
            info!("├─────────────────────────────────────────────────────────────┤");
            info!("│ World pos: {:?}", pos);
            info!("│ Chunk pos: {:?}  Local: {:?}", chunk_pos, local_pos);
            info!(
                "│ Type: {:?} (atlas: {})",
                voxel_type,
                voxel_type.atlas_index()
            );
            info!(
                "│ Solid: {}  Transparent: {}  Liquid: {}",
                voxel_type.is_solid(),
                voxel_type.is_transparent(),
                voxel_type.is_liquid()
            );
            info!("└─────────────────────────────────────────────────────────────┘");

            // 3x3x3 cube around targeted block
            info!("┌─────────────────────────────────────────────────────────────┐");
            info!("│ 3x3x3 BLOCK CUBE (centered on target)                       │");
            info!("├─────────────────────────────────────────────────────────────┤");

            for dy in (-1..=1).rev() {
                info!("│ Y={:+} layer:", dy);
                for dz in -1..=1 {
                    let mut row = String::from("│   ");
                    for dx in -1..=1 {
                        let scan_pos = pos + IVec3::new(dx, dy, dz);
                        let symbol = match world.get_voxel(scan_pos) {
                            Some(v) => {
                                if dx == 0 && dy == 0 && dz == 0 {
                                    "[X]" // Target block
                                } else if v.is_liquid() {
                                    "~W~" // Water
                                } else if v == VoxelType::Air {
                                    " . " // Air
                                } else if v.is_solid() {
                                    " # " // Solid
                                } else {
                                    " ? "
                                }
                            }
                            None => " - ", // Outside world
                        };
                        row.push_str(symbol);
                    }
                    row.push_str(&format!("  (z={:+})", dz));
                    info!("{}", row);
                }
            }
            info!("│ Legend: [X]=target  #=solid  ~W~=water  .=air  -=outside   │");
            info!("└─────────────────────────────────────────────────────────────┘");

            // Detailed neighbor analysis
            info!("┌─────────────────────────────────────────────────────────────┐");
            info!("│ DIRECT NEIGHBORS (6 faces)                                  │");
            info!("├─────────────────────────────────────────────────────────────┤");
            let neighbors = [
                ("Top    (+Y)", IVec3::Y),
                ("Bottom (-Y)", IVec3::NEG_Y),
                ("North  (+Z)", IVec3::Z),
                ("South  (-Z)", IVec3::NEG_Z),
                ("East   (+X)", IVec3::X),
                ("West   (-X)", IVec3::NEG_X),
            ];

            for (name, offset) in neighbors {
                let neighbor_pos = pos + offset;
                let neighbor_chunk = VoxelWorld::world_to_chunk(neighbor_pos);
                let cross_chunk = neighbor_chunk != chunk_pos;

                match world.get_voxel(neighbor_pos) {
                    Some(n_type) => {
                        let flags = format!(
                            "{}{}{}",
                            if n_type.is_solid() { "S" } else { "-" },
                            if n_type.is_transparent() { "T" } else { "-" },
                            if n_type.is_liquid() { "L" } else { "-" }
                        );
                        info!(
                            "│ {}: {:?} [{}] {:?}{}",
                            name,
                            n_type,
                            flags,
                            neighbor_pos,
                            if cross_chunk { " (CROSS-CHUNK)" } else { "" }
                        );
                    }
                    None => {
                        info!("│ {}: OUTSIDE WORLD at {:?}", name, neighbor_pos);
                    }
                }
            }
            info!("│ Flags: S=solid, T=transparent, L=liquid                     │");
            info!("└─────────────────────────────────────────────────────────────┘");

            // Water analysis - critical for debugging blue cracks
            info!("┌─────────────────────────────────────────────────────────────┐");
            info!("│ WATER ANALYSIS (5x5x5 area) - Blue Crack Debug              │");
            info!("├─────────────────────────────────────────────────────────────┤");

            let mut water_voxels: Vec<(IVec3, i32, i32, i32)> = Vec::new();
            let mut water_exposed_to_air = 0;
            let mut water_adjacent_to_solid = 0;

            for dx in -2..=2 {
                for dy in -2..=2 {
                    for dz in -2..=2 {
                        let scan_pos = pos + IVec3::new(dx, dy, dz);
                        if let Some(voxel) = world.get_voxel(scan_pos) {
                            if voxel.is_liquid() {
                                water_voxels.push((scan_pos, dx, dy, dz));

                                // Check adjacency
                                let mut has_air = false;
                                let mut has_solid = false;
                                for offset in [
                                    IVec3::X,
                                    IVec3::NEG_X,
                                    IVec3::Y,
                                    IVec3::NEG_Y,
                                    IVec3::Z,
                                    IVec3::NEG_Z,
                                ] {
                                    if let Some(adj) = world.get_voxel(scan_pos + offset) {
                                        if adj == VoxelType::Air {
                                            has_air = true;
                                        }
                                        if adj.is_solid() {
                                            has_solid = true;
                                        }
                                    }
                                }
                                if has_air {
                                    water_exposed_to_air += 1;
                                }
                                if has_solid {
                                    water_adjacent_to_solid += 1;
                                }
                            }
                        }
                    }
                }
            }

            info!("│ Total water voxels: {}", water_voxels.len());
            info!(
                "│ Water exposed to AIR: {} (potential visible faces)",
                water_exposed_to_air
            );
            info!(
                "│ Water adjacent to SOLID: {} (terrain contact)",
                water_adjacent_to_solid
            );

            if !water_voxels.is_empty() {
                info!("│");
                info!("│ Water positions (showing up to 15):");
                for (water_pos, dx, dy, dz) in water_voxels.iter().take(15) {
                    // Detailed per-water analysis
                    let mut adj_details = Vec::new();
                    for (dir_name, offset) in [
                        ("+X", IVec3::X),
                        ("-X", IVec3::NEG_X),
                        ("+Y", IVec3::Y),
                        ("-Y", IVec3::NEG_Y),
                        ("+Z", IVec3::Z),
                        ("-Z", IVec3::NEG_Z),
                    ] {
                        if let Some(adj) = world.get_voxel(*water_pos + offset) {
                            if adj == VoxelType::Air {
                                adj_details.push(format!("{}:Air", dir_name));
                            } else if adj.is_solid() {
                                adj_details.push(format!("{}:Sld", dir_name));
                            }
                        }
                    }
                    info!(
                        "│   {:?} (off:{:+},{:+},{:+}) -> [{}]",
                        water_pos,
                        dx,
                        dy,
                        dz,
                        adj_details.join(" ")
                    );
                }
                if water_voxels.len() > 15 {
                    info!("│   ... and {} more water voxels", water_voxels.len() - 15);
                }
            } else {
                info!("│ No water found near targeted block");
            }
            info!("└─────────────────────────────────────────────────────────────┘");

            // Air pockets analysis - potential gap areas
            info!("┌─────────────────────────────────────────────────────────────┐");
            info!("│ AIR POCKET ANALYSIS (potential gap areas)                   │");
            info!("├─────────────────────────────────────────────────────────────┤");

            let mut air_between_water_and_solid = 0;
            for dx in -2..=2 {
                for dy in -2..=2 {
                    for dz in -2..=2 {
                        let scan_pos = pos + IVec3::new(dx, dy, dz);
                        if let Some(voxel) = world.get_voxel(scan_pos) {
                            if voxel == VoxelType::Air {
                                // Check if this air is between water and solid
                                let mut has_water_neighbor = false;
                                let mut has_solid_neighbor = false;
                                for offset in [
                                    IVec3::X,
                                    IVec3::NEG_X,
                                    IVec3::Y,
                                    IVec3::NEG_Y,
                                    IVec3::Z,
                                    IVec3::NEG_Z,
                                ] {
                                    if let Some(adj) = world.get_voxel(scan_pos + offset) {
                                        if adj.is_liquid() {
                                            has_water_neighbor = true;
                                        }
                                        if adj.is_solid() {
                                            has_solid_neighbor = true;
                                        }
                                    }
                                }
                                if has_water_neighbor && has_solid_neighbor {
                                    air_between_water_and_solid += 1;
                                    info!(
                                        "│ AIR GAP at {:?} (off:{:+},{:+},{:+}) - water+solid neighbors!",
                                        scan_pos, dx, dy, dz
                                    );
                                }
                            }
                        }
                    }
                }
            }

            if air_between_water_and_solid == 0 {
                info!("│ No air gaps found between water and solid blocks");
            } else {
                info!(
                    "│ FOUND {} air gaps between water and solid!",
                    air_between_water_and_solid
                );
            }
            info!("└─────────────────────────────────────────────────────────────┘");
        } else {
            info!("│ No block targeted - look at a block first");
        }

        info!("══════════════════════════════════════════════════════════════════");
    }
}

/// Setup debug overlay UI
pub fn setup_debug_overlay(mut commands: Commands) {
    commands.spawn((
        Text::new(""),
        TextFont {
            font_size: 14.0,
            ..default()
        },
        TextColor(Color::srgba(1.0, 1.0, 0.0, 0.9)),
        Node {
            position_type: PositionType::Absolute,
            top: Val::Px(10.0),
            left: Val::Px(10.0),
            ..default()
        },
        Visibility::Hidden,
        DebugOverlay,
    ));
}

/// Toggle debug overlay with F3 key
pub fn toggle_debug_overlay(
    keyboard: Res<ButtonInput<KeyCode>>,
    mut state: ResMut<DebugOverlayState>,
    mut query: Query<&mut Visibility, With<DebugOverlay>>,
) {
    if keyboard.just_pressed(KeyCode::F3) {
        state.visible = !state.visible;
        for mut vis in query.iter_mut() {
            *vis = if state.visible {
                Visibility::Visible
            } else {
                Visibility::Hidden
            };
        }
    }
}

/// Toggle optional debug detail sections
pub fn toggle_debug_details(
    keyboard: Res<ButtonInput<KeyCode>>,
    mut toggles: ResMut<DebugDetailToggles>,
) {
    if keyboard.just_pressed(KeyCode::KeyV) {
        toggles.show_vertex_corners = !toggles.show_vertex_corners;
    }

    if keyboard.just_pressed(KeyCode::KeyT) {
        toggles.show_texture_details = !toggles.show_texture_details;
    }

    if keyboard.just_pressed(KeyCode::KeyN) {
        toggles.show_multiplayer = !toggles.show_multiplayer;
    }
}

/// Update debug overlay text with real-time info
pub fn update_debug_overlay(
    state: Res<DebugOverlayState>,
    targeted: Res<TargetedBlock>,
    world: Res<VoxelWorld>,
    edit_mode: Res<EditMode>,
    delete_mode: Res<DeleteMode>,
    drag_state: Res<DragState>,
    network: Res<NetworkSession>,
    camera_query: Query<&Transform, With<crate::camera::controller::PlayerCamera>>,
    diagnostics: Res<DiagnosticsStore>,
    toggles: Res<DebugDetailToggles>,
    mut query: Query<&mut Text, With<DebugOverlay>>,
) {
    if !state.visible {
        return;
    }

    let mut text_content = String::new();

    // Camera position
    if let Ok(camera) = camera_query.single() {
        let pos = camera.translation;
        text_content.push_str(&format!(
            "Pos: ({:.1}, {:.1}, {:.1})\n",
            pos.x, pos.y, pos.z
        ));

        let block_pos = IVec3::new(
            pos.x.floor() as i32,
            pos.y.floor() as i32,
            pos.z.floor() as i32,
        );
        let chunk_pos = VoxelWorld::world_to_chunk(block_pos);
        text_content.push_str(&format!("Chunk: {:?}\n", chunk_pos));
    }

    // Performance
    let fps = diagnostics
        .get(&FrameTimeDiagnosticsPlugin::FPS)
        .and_then(|fps_diag| fps_diag.average())
        .map(|value| format!("{value:.1}"))
        .unwrap_or_else(|| "N/A".to_string());
    text_content.push_str(&format!("FPS: {}\n", fps));

    text_content.push_str("\n");

    // Targeted block info
    if let (Some(pos), Some(voxel_type)) = (targeted.position, targeted.voxel_type) {
        text_content.push_str(&format!("Target: {:?}\n", pos));
        text_content.push_str(&format!("Type: {:?}\n", voxel_type));

        // Water scan in 5x5x5 area
        let mut water_count = 0;
        let mut water_with_air = 0;
        for dx in -2..=2 {
            for dy in -2..=2 {
                for dz in -2..=2 {
                    let scan_pos = pos + IVec3::new(dx, dy, dz);
                    if let Some(voxel) = world.get_voxel(scan_pos) {
                        if voxel.is_liquid() {
                            water_count += 1;
                            // Check if this water is adjacent to air
                            for offset in [
                                IVec3::X,
                                IVec3::NEG_X,
                                IVec3::Y,
                                IVec3::NEG_Y,
                                IVec3::Z,
                                IVec3::NEG_Z,
                            ] {
                                if let Some(adj) = world.get_voxel(scan_pos + offset) {
                                    if adj == VoxelType::Air {
                                        water_with_air += 1;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        text_content.push_str(&format!("\nWater (5x5x5): {}\n", water_count));
        text_content.push_str(&format!("Water+Air adj: {}\n", water_with_air));

        if toggles.show_texture_details {
            text_content.push_str("\n[Texture debug]\n");
            text_content.push_str(&format!("Atlas index: {}\n", voxel_type.atlas_index()));
            text_content.push_str(&format!(
                "Solid: {}  Transparent: {}  Liquid: {}\n",
                voxel_type.is_solid(),
                voxel_type.is_transparent(),
                voxel_type.is_liquid()
            ));
            if let Some(normal) = targeted.normal {
                text_content.push_str(&format!("Target face normal: {:?}\n", normal));
            }
        }

        if toggles.show_vertex_corners {
            text_content.push_str("\n[Vertex corners]\n");
            let base = pos.as_vec3();
            let corners = [
                base,
                base + Vec3::X,
                base + Vec3::Y,
                base + Vec3::Z,
                base + Vec3::X + Vec3::Y,
                base + Vec3::X + Vec3::Z,
                base + Vec3::Y + Vec3::Z,
                base + Vec3::X + Vec3::Y + Vec3::Z,
            ];

            for (i, corner) in corners.iter().enumerate() {
                text_content.push_str(&format!(
                    "C{}: ({:.1}, {:.1}, {:.1})\n",
                    i + 1,
                    corner.x,
                    corner.y,
                    corner.z
                ));
            }
        }
    } else {
        text_content.push_str("Target: None\n");
    }

    if toggles.show_multiplayer {
        text_content.push_str("\n[Multiplayer]\n");
        text_content.push_str(&format!(
            "Hosting: {}\n",
            if network.server_running { "YES" } else { "NO" }
        ));
        text_content.push_str(&format!(
            "Client connected: {}\n",
            if network.client_connected {
                "YES"
            } else {
                "NO"
            }
        ));

        if let (Some(ip), Some(port)) = (&network.connection_ip, &network.connection_port) {
            text_content.push_str(&format!("Peer: {}:{}\n", ip, port));
        }

        let latency = network
            .last_latency_ms
            .map(|ms| format!("{ms} ms"))
            .unwrap_or_else(|| "N/A".to_string());
        text_content.push_str(&format!("Latency: {}\n", latency));

        text_content.push_str(&format!(
            "Health: {}\n",
            if network.last_health_ok {
                "OK"
            } else {
                "Unhealthy"
            }
        ));
    }

    text_content.push_str("\n[F3] Toggle overlay");
    text_content.push_str("\n[G] Detailed log");
    text_content.push_str(&format!(
        "\n[Shift+M] Edit mode: {}",
        if edit_mode.enabled { "ON" } else { "OFF" }
    ));
    if edit_mode.enabled {
        text_content.push_str(&format!(
            "\n    Dragging: {}",
            if drag_state.dragged_block.is_some() {
                "YES"
            } else {
                "NO"
            }
        ));
        text_content.push_str(&format!(
            "\n    Delete mode: {} (Del)",
            if delete_mode.enabled { "ON" } else { "OFF" }
        ));
        if drag_state.dragged_block.is_some() {
            text_content.push_str(&format!(
                "\n    Rotation: {:.0}° (scroll/Q/E)",
                drag_state.rotation_degrees
            ));
        }
    }
    text_content.push_str(&format!(
        "\n[V] Vertex corners: {}",
        if toggles.show_vertex_corners {
            "ON"
        } else {
            "OFF"
        }
    ));
    text_content.push_str(&format!(
        "\n[T] Texture debug: {}",
        if toggles.show_texture_details {
            "ON"
        } else {
            "OFF"
        }
    ));
    text_content.push_str(&format!(
        "\n[N] Multiplayer debug: {}",
        if toggles.show_multiplayer {
            "ON"
        } else {
            "OFF"
        }
    ));

    for mut text in query.iter_mut() {
        **text = text_content.clone();
    }
}

/// Plugin for block interaction
pub struct InteractionPlugin;

impl Plugin for InteractionPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<TargetedBlock>()
            .init_resource::<TargetedEntity>()
            .init_resource::<HeldBlock>()
            .init_resource::<EditMode>()
            .init_resource::<DeleteMode>()
            .init_resource::<DragState>()
            .init_resource::<DebugOverlayState>()
            .init_resource::<DebugDetailToggles>()
            .init_resource::<palette::PaletteItems>()
            .init_resource::<PlacementPaletteState>()
            .init_resource::<palette::BookmarkStore>()
            .add_systems(Startup, setup_debug_overlay)
            .add_systems(Startup, palette::load_bookmarks)
            .add_systems(
                Update,
                (
                    update_targeted_block,
                    update_targeted_entity,
                    palette::initialize_palette_items,
                    palette::toggle_palette,
                    palette::handle_palette_input,
                    palette::handle_bookmark_buttons,
                    toggle_edit_mode,
                    toggle_delete_mode,
                    start_dragging_block,
                    palette::handle_palette_item_click,
                    delete_block_in_edit_mode,
                    update_drag_rotation,
                )
                    .run_if(|state: Res<PauseMenuState>| !state.open),
            )
            .add_systems(
                Update,
                (
                    finish_dragging_block,
                    palette::place_prop_from_palette,
                    palette::persist_bookmarks,
                    attack_entity_system,
                    break_block_system,
                    place_block_system,
                    palette::refresh_palette_ui,
                    render_block_highlight,
                    debug_voxel_info_system,
                    toggle_debug_overlay,
                    toggle_debug_details,
                    update_debug_overlay,
                )
                    .run_if(|state: Res<PauseMenuState>| !state.open),
            );
    }
}
