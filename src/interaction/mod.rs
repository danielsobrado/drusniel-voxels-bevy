//! Block and entity interaction systems.
//!
//! This module provides player interaction with the voxel world including:
//! - Block targeting and raycasting
//! - Block breaking and placing
//! - Edit mode (drag & drop blocks)
//! - Entity targeting and attacking
//! - Debug overlays

use crate::camera::controller::PlayerCamera;
use crate::constants::{
    ATTACK_DAMAGE, ENTITY_TARGET_CONE, ENTITY_TARGET_RADIUS, INTERACTION_RANGE, RAY_STEP,
};
use crate::entity::{Health, Wolf};
use crate::interaction::palette::{PlacementPaletteState, PlacementSelection};
use crate::menu::PauseMenuState;
use crate::network::NetworkSession;
use crate::particles::{ParticleType, SpawnParticleEvent};
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::VoxelWorld;
use bevy::diagnostic::{DiagnosticsStore, FrameTimeDiagnosticsPlugin};
use bevy::input::mouse::MouseWheel;
use bevy::prelude::*;

pub mod palette;

// ============================================================================
// Components
// ============================================================================

/// Component to mark the block highlight entity
#[derive(Component)]
pub struct BlockHighlight;

/// Component to mark the debug overlay text
#[derive(Component)]
pub struct DebugOverlay;

// ============================================================================
// Resources
// ============================================================================

/// Resource to track debug overlay visibility
#[derive(Resource, Default)]
pub struct DebugOverlayState {
    pub visible: bool,
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

// ============================================================================
// Raycasting
// ============================================================================

/// Cast a ray and find the first solid block hit
pub fn raycast_blocks(
    origin: Vec3,
    direction: Vec3,
    world: &VoxelWorld,
    max_distance: f32,
) -> Option<(IVec3, IVec3)> {
    let mut pos = origin;
    let step = direction.normalize() * RAY_STEP;
    let mut prev_block = pos.floor().as_ivec3();

    let steps = (max_distance / RAY_STEP) as i32;

    for _ in 0..steps {
        pos += step;
        let block_pos = pos.floor().as_ivec3();

        if block_pos != prev_block {
            if let Some(voxel) = world.get_voxel(block_pos) {
                if voxel.is_solid() {
                    let normal = prev_block - block_pos;
                    return Some((block_pos, normal));
                }
            }
            prev_block = block_pos;
        }
    }

    None
}

// ============================================================================
// Targeting Systems
// ============================================================================

/// System to update the targeted block based on camera look direction
pub fn update_targeted_block(
    camera_query: Query<&Transform, With<PlayerCamera>>,
    world: Res<VoxelWorld>,
    mut targeted: ResMut<TargetedBlock>,
) {
    let Ok(transform) = camera_query.single() else {
        return;
    };

    let origin = transform.translation;
    let direction = transform.forward().as_vec3();

    if let Some((block_pos, normal)) = raycast_blocks(origin, direction, &world, INTERACTION_RANGE)
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

/// System to update the targeted entity based on camera look direction
pub fn update_targeted_entity(
    camera_query: Query<&Transform, With<PlayerCamera>>,
    entity_query: Query<(Entity, &Transform), With<Wolf>>,
    mut targeted: ResMut<TargetedEntity>,
) {
    targeted.entity = None;
    targeted.distance = f32::MAX;

    let Ok(camera_transform) = camera_query.single() else {
        return;
    };

    let origin = camera_transform.translation;
    let direction = camera_transform.forward().as_vec3();

    for (entity, entity_transform) in entity_query.iter() {
        let to_entity = entity_transform.translation - origin;
        let distance = to_entity.length();

        if distance > INTERACTION_RANGE {
            continue;
        }

        let dot = to_entity.normalize().dot(direction);
        if dot < ENTITY_TARGET_CONE {
            continue;
        }

        let closest_point = origin + direction * dot * distance;
        let dist_to_ray = (entity_transform.translation - closest_point).length();

        if dist_to_ray < ENTITY_TARGET_RADIUS && distance < targeted.distance {
            targeted.entity = Some(entity);
            targeted.distance = distance;
        }
    }
}

// ============================================================================
// Combat & Block Interaction
// ============================================================================

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

    if !mouse.just_pressed(MouseButton::Left) || targeted_entity.entity.is_some() {
        return;
    }

    let (Some(pos), Some(voxel_type)) = (targeted_block.position, targeted_block.voxel_type) else {
        return;
    };

    if voxel_type == VoxelType::Bedrock {
        return;
    }

    held.block_type = voxel_type;
    world.set_voxel(pos, VoxelType::Air);
    mark_neighbors_dirty(&mut world, pos);

    let center = Vec3::new(pos.x as f32 + 0.5, pos.y as f32 + 0.5, pos.z as f32 + 0.5);
    particle_events.write(SpawnParticleEvent {
        position: center,
        particle_type: ParticleType::Dig,
    });
}

/// System to handle block placing (right click)
pub fn place_block_system(
    mouse: Res<ButtonInput<MouseButton>>,
    edit_mode: Res<EditMode>,
    delete_mode: Res<DeleteMode>,
    targeted: Res<TargetedBlock>,
    mut world: ResMut<VoxelWorld>,
    held: Res<HeldBlock>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    drag_state: Res<DragState>,
    palette: Res<PlacementPaletteState>,
) {
    let placing_in_edit_mode = edit_mode.enabled
        && palette
            .active_selection
            .as_ref()
            .is_some_and(|selection| matches!(selection, PlacementSelection::Voxel(_)));

    if edit_mode.enabled && !placing_in_edit_mode {
        return;
    }

    if delete_mode.enabled || drag_state.dragged_block.is_some() {
        return;
    }

    if !mouse.just_pressed(MouseButton::Right) {
        return;
    }

    let (Some(block_pos), Some(normal)) = (targeted.position, targeted.normal) else {
        return;
    };

    let place_pos = block_pos + normal;

    if is_player_blocking_position(&camera_query, place_pos) {
        return;
    }

    if let Some(existing) = world.get_voxel(place_pos) {
        if existing == VoxelType::Air || existing == VoxelType::Water {
            world.set_voxel(place_pos, held.block_type);
            mark_neighbors_dirty(&mut world, place_pos);
        }
    }
}

fn is_player_blocking_position(
    camera_query: &Query<&Transform, With<PlayerCamera>>,
    place_pos: IVec3,
) -> bool {
    let Ok(camera_transform) = camera_query.single() else {
        return false;
    };

    let player_pos = camera_transform.translation;
    let player_block = player_pos.floor().as_ivec3();
    let player_feet = IVec3::new(
        player_pos.x.floor() as i32,
        (player_pos.y - 1.8).floor() as i32,
        player_pos.z.floor() as i32,
    );

    place_pos == player_block || place_pos == player_feet
}

/// Mark a block and its neighbors as dirty for mesh regeneration
fn mark_neighbors_dirty(world: &mut VoxelWorld, pos: IVec3) {
    let chunk_pos = VoxelWorld::world_to_chunk(pos);
    if let Some(chunk) = world.get_chunk_mut(chunk_pos) {
        chunk.mark_dirty();
    }

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

// ============================================================================
// Edit Mode Systems
// ============================================================================

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

    if !keyboard.just_pressed(KeyCode::KeyM) || !shift_pressed {
        return;
    }

    edit_mode.enabled = !edit_mode.enabled;
    delete_mode.enabled = false;

    if edit_mode.enabled {
        info!("Edit mode enabled - click and drag a block to move it");
    } else {
        restore_dragged_block(&mut drag_state, &mut world);
        info!("Edit mode disabled");
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

    if !keyboard.just_pressed(KeyCode::Delete) {
        return;
    }

    delete_mode.enabled = !delete_mode.enabled;

    if delete_mode.enabled {
        restore_dragged_block(&mut drag_state, &mut world);
        info!("Delete mode enabled - left click a block to remove it");
    } else {
        info!("Delete mode disabled");
    }
}

fn restore_dragged_block(drag_state: &mut DragState, world: &mut VoxelWorld) {
    if let Some(dragged) = drag_state.dragged_block.take() {
        world.set_voxel(dragged.original_position, dragged.block_type);
        mark_neighbors_dirty(world, dragged.original_position);
    }
    drag_state.rotation_degrees = 0.0;
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

    let (Some(pos), Some(voxel_type)) = (targeted_block.position, targeted_block.voxel_type) else {
        return;
    };

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

/// Finish dragging by placing the block at the targeted location, or restore it if invalid
pub fn finish_dragging_block(
    edit_mode: Res<EditMode>,
    mouse: Res<ButtonInput<MouseButton>>,
    targeted_block: Res<TargetedBlock>,
    mut drag_state: ResMut<DragState>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    mut world: ResMut<VoxelWorld>,
) {
    if !edit_mode.enabled || !mouse.just_released(MouseButton::Left) {
        return;
    }

    let Some(dragged) = drag_state.dragged_block.take() else {
        return;
    };

    let placement_result =
        try_place_dragged_block(&targeted_block, &camera_query, &world);

    match placement_result {
        Some(grounded_pos) => {
            world.set_voxel(grounded_pos, dragged.block_type);
            mark_neighbors_dirty(&mut world, grounded_pos);
        }
        None => {
            world.set_voxel(dragged.original_position, dragged.block_type);
            mark_neighbors_dirty(&mut world, dragged.original_position);
        }
    }

    drag_state.rotation_degrees = 0.0;
}

fn try_place_dragged_block(
    targeted_block: &TargetedBlock,
    camera_query: &Query<&Transform, With<PlayerCamera>>,
    world: &VoxelWorld,
) -> Option<IVec3> {
    let (block_pos, normal) = (targeted_block.position?, targeted_block.normal?);
    let place_pos = block_pos + normal;
    let grounded_pos = find_grounded_position(place_pos, world)?;

    if is_player_blocking_position(camera_query, grounded_pos) {
        return None;
    }

    let existing = world.get_voxel(grounded_pos)?;
    if existing != VoxelType::Air && existing != VoxelType::Water {
        return None;
    }

    Some(grounded_pos)
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
        drag_state.rotation_degrees = (drag_state.rotation_degrees + rotation_delta).rem_euclid(360.0);
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

    if !mouse.just_pressed(MouseButton::Left) {
        return;
    }

    let (Some(pos), Some(voxel_type)) = (targeted_block.position, targeted_block.voxel_type) else {
        return;
    };

    if voxel_type != VoxelType::Bedrock {
        world.set_voxel(pos, VoxelType::Air);
        mark_neighbors_dirty(&mut world, pos);
    }
}

/// Given a desired placement coordinate, drop it to the nearest supported position
fn find_grounded_position(start: IVec3, world: &VoxelWorld) -> Option<IVec3> {
    if !world.in_bounds(start) {
        return None;
    }

    let mut pos = start;

    match world.get_voxel(pos) {
        Some(voxel) if voxel.is_solid() => return None,
        Some(_) => {}
        None => return None,
    }

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

// ============================================================================
// Block Highlight Rendering
// ============================================================================

/// System to render block highlight wireframe
pub fn render_block_highlight(
    targeted: Res<TargetedBlock>,
    drag_state: Res<DragState>,
    edit_mode: Res<EditMode>,
    world: Res<VoxelWorld>,
    mut gizmos: Gizmos,
) {
    let Some(pos) = targeted.position else {
        return;
    };

    let center = Vec3::new(pos.x as f32 + 0.5, pos.y as f32 + 0.5, pos.z as f32 + 0.5);
    let half_size = Vec3::splat(0.505);

    gizmos.cuboid(
        Transform::from_translation(center).with_scale(half_size * 2.0),
        Color::srgba(1.0, 1.0, 1.0, 0.8),
    );

    if edit_mode.enabled && drag_state.dragged_block.is_some() {
        render_placement_arrow(&targeted, &drag_state, &world, &mut gizmos);
    }
}

fn render_placement_arrow(
    targeted: &TargetedBlock,
    drag_state: &DragState,
    world: &VoxelWorld,
    gizmos: &mut Gizmos,
) {
    let (Some(pos), Some(normal)) = (targeted.position, targeted.normal) else {
        return;
    };

    let desired = pos + normal;
    let Some(grounded) = find_grounded_position(desired, world) else {
        return;
    };

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

// ============================================================================
// Debug Systems
// ============================================================================

/// System to debug voxel info when G is pressed
pub fn debug_voxel_info_system(
    keyboard: Res<ButtonInput<KeyCode>>,
    targeted: Res<TargetedBlock>,
    world: Res<VoxelWorld>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
) {
    if !keyboard.just_pressed(KeyCode::KeyG) {
        return;
    }

    print_debug_header();
    print_camera_position(&camera_query);

    let (Some(pos), Some(voxel_type)) = (targeted.position, targeted.voxel_type) else {
        info!("│ No block targeted - look at a block first");
        info!("══════════════════════════════════════════════════════════════════");
        return;
    };

    print_targeted_block_info(pos, voxel_type);
    print_3x3_cube(&world, pos);
    print_neighbor_analysis(&world, pos);
    print_water_analysis(&world, pos);
    print_air_gap_analysis(&world, pos);

    info!("══════════════════════════════════════════════════════════════════");
}

fn print_debug_header() {
    info!("╔══════════════════════════════════════════════════════════════╗");
    info!("║              DETAILED BLOCK DEBUG INFO [G]                   ║");
    info!("╚══════════════════════════════════════════════════════════════╝");
}

fn print_camera_position(camera_query: &Query<&Transform, With<PlayerCamera>>) {
    if let Ok(camera) = camera_query.single() {
        let pos = camera.translation;
        info!("Camera: ({:.2}, {:.2}, {:.2})", pos.x, pos.y, pos.z);
    }
}

fn print_targeted_block_info(pos: IVec3, voxel_type: VoxelType) {
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
}

fn print_3x3_cube(world: &VoxelWorld, pos: IVec3) {
    info!("┌─────────────────────────────────────────────────────────────┐");
    info!("│ 3x3x3 BLOCK CUBE (centered on target)                       │");
    info!("├─────────────────────────────────────────────────────────────┤");

    for dy in (-1..=1).rev() {
        info!("│ Y={:+} layer:", dy);
        for dz in -1..=1 {
            let mut row = String::from("│   ");
            for dx in -1..=1 {
                let scan_pos = pos + IVec3::new(dx, dy, dz);
                let symbol = get_voxel_symbol(world, scan_pos, dx == 0 && dy == 0 && dz == 0);
                row.push_str(symbol);
            }
            row.push_str(&format!("  (z={:+})", dz));
            info!("{}", row);
        }
    }
    info!("│ Legend: [X]=target  #=solid  ~W~=water  .=air  -=outside   │");
    info!("└─────────────────────────────────────────────────────────────┘");
}

fn get_voxel_symbol(world: &VoxelWorld, pos: IVec3, is_target: bool) -> &'static str {
    match world.get_voxel(pos) {
        Some(v) => {
            if is_target {
                "[X]"
            } else if v.is_liquid() {
                "~W~"
            } else if v == VoxelType::Air {
                " . "
            } else if v.is_solid() {
                " # "
            } else {
                " ? "
            }
        }
        None => " - ",
    }
}

fn print_neighbor_analysis(world: &VoxelWorld, pos: IVec3) {
    let chunk_pos = VoxelWorld::world_to_chunk(pos);

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
}

fn print_water_analysis(world: &VoxelWorld, pos: IVec3) {
    info!("┌─────────────────────────────────────────────────────────────┐");
    info!("│ WATER ANALYSIS (5x5x5 area) - Blue Crack Debug              │");
    info!("├─────────────────────────────────────────────────────────────┤");

    let (water_voxels, water_exposed_to_air, water_adjacent_to_solid) =
        analyze_water_in_area(world, pos);

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
            let adj_details = get_water_adjacency_details(world, *water_pos);
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
}

fn analyze_water_in_area(
    world: &VoxelWorld,
    center: IVec3,
) -> (Vec<(IVec3, i32, i32, i32)>, usize, usize) {
    let mut water_voxels = Vec::new();
    let mut water_exposed_to_air = 0;
    let mut water_adjacent_to_solid = 0;

    let face_offsets = [
        IVec3::X,
        IVec3::NEG_X,
        IVec3::Y,
        IVec3::NEG_Y,
        IVec3::Z,
        IVec3::NEG_Z,
    ];

    for dx in -2..=2 {
        for dy in -2..=2 {
            for dz in -2..=2 {
                let scan_pos = center + IVec3::new(dx, dy, dz);
                let Some(voxel) = world.get_voxel(scan_pos) else {
                    continue;
                };

                if !voxel.is_liquid() {
                    continue;
                }

                water_voxels.push((scan_pos, dx, dy, dz));

                let mut has_air = false;
                let mut has_solid = false;
                for offset in face_offsets {
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

    (water_voxels, water_exposed_to_air, water_adjacent_to_solid)
}

fn get_water_adjacency_details(world: &VoxelWorld, water_pos: IVec3) -> Vec<String> {
    let directions = [
        ("+X", IVec3::X),
        ("-X", IVec3::NEG_X),
        ("+Y", IVec3::Y),
        ("-Y", IVec3::NEG_Y),
        ("+Z", IVec3::Z),
        ("-Z", IVec3::NEG_Z),
    ];

    let mut details = Vec::new();
    for (dir_name, offset) in directions {
        if let Some(adj) = world.get_voxel(water_pos + offset) {
            if adj == VoxelType::Air {
                details.push(format!("{}:Air", dir_name));
            } else if adj.is_solid() {
                details.push(format!("{}:Sld", dir_name));
            }
        }
    }
    details
}

fn print_air_gap_analysis(world: &VoxelWorld, pos: IVec3) {
    info!("┌─────────────────────────────────────────────────────────────┐");
    info!("│ AIR POCKET ANALYSIS (potential gap areas)                   │");
    info!("├─────────────────────────────────────────────────────────────┤");

    let air_gaps = find_air_gaps(world, pos);

    if air_gaps == 0 {
        info!("│ No air gaps found between water and solid blocks");
    } else {
        info!("│ FOUND {} air gaps between water and solid!", air_gaps);
    }
    info!("└─────────────────────────────────────────────────────────────┘");
}

fn find_air_gaps(world: &VoxelWorld, center: IVec3) -> usize {
    let face_offsets = [
        IVec3::X,
        IVec3::NEG_X,
        IVec3::Y,
        IVec3::NEG_Y,
        IVec3::Z,
        IVec3::NEG_Z,
    ];

    let mut air_between_water_and_solid = 0;

    for dx in -2..=2 {
        for dy in -2..=2 {
            for dz in -2..=2 {
                let scan_pos = center + IVec3::new(dx, dy, dz);
                let Some(voxel) = world.get_voxel(scan_pos) else {
                    continue;
                };

                if voxel != VoxelType::Air {
                    continue;
                }

                let mut has_water_neighbor = false;
                let mut has_solid_neighbor = false;
                for offset in face_offsets {
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

    air_between_water_and_solid
}

// ============================================================================
// Debug Overlay UI
// ============================================================================

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
    if !keyboard.just_pressed(KeyCode::F3) {
        return;
    }

    state.visible = !state.visible;
    for mut vis in query.iter_mut() {
        *vis = if state.visible {
            Visibility::Visible
        } else {
            Visibility::Hidden
        };
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
    camera_query: Query<&Transform, With<PlayerCamera>>,
    diagnostics: Res<DiagnosticsStore>,
    toggles: Res<DebugDetailToggles>,
    mut query: Query<&mut Text, With<DebugOverlay>>,
) {
    if !state.visible {
        return;
    }

    let mut text = String::new();

    append_position_info(&mut text, &camera_query);
    append_fps_info(&mut text, &diagnostics);
    text.push('\n');
    append_target_info(&mut text, &targeted, &world, &toggles);
    append_multiplayer_info(&mut text, &network, &toggles);
    append_controls_info(&mut text, &edit_mode, &delete_mode, &drag_state, &toggles);

    for mut overlay_text in query.iter_mut() {
        **overlay_text = text.clone();
    }
}

fn append_position_info(text: &mut String, camera_query: &Query<&Transform, With<PlayerCamera>>) {
    if let Ok(camera) = camera_query.single() {
        let pos = camera.translation;
        text.push_str(&format!(
            "Pos: ({:.1}, {:.1}, {:.1})\n",
            pos.x, pos.y, pos.z
        ));

        let block_pos = pos.floor().as_ivec3();
        let chunk_pos = VoxelWorld::world_to_chunk(block_pos);
        text.push_str(&format!("Chunk: {:?}\n", chunk_pos));
    }
}

fn append_fps_info(text: &mut String, diagnostics: &DiagnosticsStore) {
    let fps = diagnostics
        .get(&FrameTimeDiagnosticsPlugin::FPS)
        .and_then(|fps_diag| fps_diag.average())
        .map(|value| format!("{value:.1}"))
        .unwrap_or_else(|| "N/A".to_string());
    text.push_str(&format!("FPS: {}\n", fps));
}

fn append_target_info(
    text: &mut String,
    targeted: &TargetedBlock,
    world: &VoxelWorld,
    toggles: &DebugDetailToggles,
) {
    let (Some(pos), Some(voxel_type)) = (targeted.position, targeted.voxel_type) else {
        text.push_str("Target: None\n");
        return;
    };

    text.push_str(&format!("Target: {:?}\n", pos));
    text.push_str(&format!("Type: {:?}\n", voxel_type));

    let (water_count, water_with_air) = count_water_in_area(world, pos);
    text.push_str(&format!("\nWater (5x5x5): {}\n", water_count));
    text.push_str(&format!("Water+Air adj: {}\n", water_with_air));

    if toggles.show_texture_details {
        append_texture_details(text, voxel_type, targeted.normal);
    }

    if toggles.show_vertex_corners {
        append_vertex_corners(text, pos);
    }
}

fn count_water_in_area(world: &VoxelWorld, center: IVec3) -> (usize, usize) {
    let face_offsets = [
        IVec3::X,
        IVec3::NEG_X,
        IVec3::Y,
        IVec3::NEG_Y,
        IVec3::Z,
        IVec3::NEG_Z,
    ];

    let mut water_count = 0;
    let mut water_with_air = 0;

    for dx in -2..=2 {
        for dy in -2..=2 {
            for dz in -2..=2 {
                let scan_pos = center + IVec3::new(dx, dy, dz);
                let Some(voxel) = world.get_voxel(scan_pos) else {
                    continue;
                };

                if !voxel.is_liquid() {
                    continue;
                }

                water_count += 1;

                for offset in face_offsets {
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

    (water_count, water_with_air)
}

fn append_texture_details(text: &mut String, voxel_type: VoxelType, normal: Option<IVec3>) {
    text.push_str("\n[Texture debug]\n");
    text.push_str(&format!("Atlas index: {}\n", voxel_type.atlas_index()));
    text.push_str(&format!(
        "Solid: {}  Transparent: {}  Liquid: {}\n",
        voxel_type.is_solid(),
        voxel_type.is_transparent(),
        voxel_type.is_liquid()
    ));
    if let Some(n) = normal {
        text.push_str(&format!("Target face normal: {:?}\n", n));
    }
}

fn append_vertex_corners(text: &mut String, pos: IVec3) {
    text.push_str("\n[Vertex corners]\n");
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
        text.push_str(&format!(
            "C{}: ({:.1}, {:.1}, {:.1})\n",
            i + 1,
            corner.x,
            corner.y,
            corner.z
        ));
    }
}

fn append_multiplayer_info(text: &mut String, network: &NetworkSession, toggles: &DebugDetailToggles) {
    if !toggles.show_multiplayer {
        return;
    }

    text.push_str("\n[Multiplayer]\n");
    text.push_str(&format!(
        "Hosting: {}\n",
        if network.server_running { "YES" } else { "NO" }
    ));
    text.push_str(&format!(
        "Client connected: {}\n",
        if network.client_connected { "YES" } else { "NO" }
    ));

    if let (Some(ip), Some(port)) = (&network.connection_ip, &network.connection_port) {
        text.push_str(&format!("Peer: {}:{}\n", ip, port));
    }

    let latency = network
        .last_latency_ms
        .map(|ms| format!("{ms} ms"))
        .unwrap_or_else(|| "N/A".to_string());
    text.push_str(&format!("Latency: {}\n", latency));

    text.push_str(&format!(
        "Health: {}\n",
        if network.last_health_ok { "OK" } else { "Unhealthy" }
    ));
}

fn append_controls_info(
    text: &mut String,
    edit_mode: &EditMode,
    delete_mode: &DeleteMode,
    drag_state: &DragState,
    toggles: &DebugDetailToggles,
) {
    text.push_str("\n[F3] Toggle overlay");
    text.push_str("\n[G] Detailed log");
    text.push_str(&format!(
        "\n[Shift+M] Edit mode: {}",
        if edit_mode.enabled { "ON" } else { "OFF" }
    ));

    if edit_mode.enabled {
        text.push_str(&format!(
            "\n    Dragging: {}",
            if drag_state.dragged_block.is_some() { "YES" } else { "NO" }
        ));
        text.push_str(&format!(
            "\n    Delete mode: {} (Del)",
            if delete_mode.enabled { "ON" } else { "OFF" }
        ));
        if drag_state.dragged_block.is_some() {
            text.push_str(&format!(
                "\n    Rotation: {:.0}° (scroll/Q/E)",
                drag_state.rotation_degrees
            ));
        }
    }

    text.push_str(&format!(
        "\n[V] Vertex corners: {}",
        if toggles.show_vertex_corners { "ON" } else { "OFF" }
    ));
    text.push_str(&format!(
        "\n[T] Texture debug: {}",
        if toggles.show_texture_details { "ON" } else { "OFF" }
    ));
    text.push_str(&format!(
        "\n[N] Multiplayer debug: {}",
        if toggles.show_multiplayer { "ON" } else { "OFF" }
    ));
}

// ============================================================================
// Plugin
// ============================================================================

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
