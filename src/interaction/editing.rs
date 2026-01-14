//! Block editing systems (edit mode, drag & drop, delete mode).
//!
//! This module provides systems for editing the voxel world:
//! - Edit mode: Toggle with Shift+M to enable block dragging
//! - Drag mode: Click and drag blocks to move them
//! - Delete mode: Toggle with Delete key in edit mode to remove blocks

use bevy::input::mouse::MouseWheel;
use bevy::prelude::*;
use crate::interaction::targeting::TargetedBlock;
use crate::interaction::palette::PlacementPaletteState;
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::VoxelWorld;

/// Resource that enables edit mode for dragging blocks.
#[derive(Resource, Default)]
pub struct EditMode {
    pub enabled: bool,
}

/// Resource to track delete mode while editing.
#[derive(Resource, Default)]
pub struct DeleteMode {
    pub enabled: bool,
}

/// State for an in-progress drag operation.
#[derive(Resource, Default)]
pub struct DragState {
    pub dragged_block: Option<DraggedBlock>,
    pub rotation_degrees: f32,
}

/// Information about the block being dragged.
pub struct DraggedBlock {
    pub block_type: VoxelType,
    pub original_position: IVec3,
}

/// Toggle edit mode with Shift+M and restore any dragged block when disabling.
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

/// Toggle delete mode with the Delete key when edit mode is enabled.
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

/// Begin dragging the currently targeted block when in edit mode.
pub fn start_dragging_block(
    edit_mode: Res<EditMode>,
    delete_mode: Res<DeleteMode>,
    mouse: Res<ButtonInput<MouseButton>>,
    targeted_block: Res<TargetedBlock>,
    mut drag_state: ResMut<DragState>,
    mut world: ResMut<VoxelWorld>,
    palette: Res<PlacementPaletteState>,
) {
    if !edit_mode.enabled || delete_mode.enabled || !mouse.just_pressed(MouseButton::Left) {
        return;
    }

    // Don't start dragging if palette is selecting a voxel
    if palette.active_selection.is_some() {
        return;
    }

    if drag_state.dragged_block.is_some() {
        return;
    }

    if let (Some(pos), Some(voxel_type)) = (targeted_block.position, targeted_block.voxel_type) {
        if !super::can_modify_at(pos) {
            return;
        }

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

/// Finish dragging by placing the block at the targeted location, or restore it if invalid.
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

        if !super::can_modify_at(grounded_pos) {
            world.set_voxel(dragged.original_position, dragged.block_type);
            mark_neighbors_dirty(&mut world, dragged.original_position);
            return;
        }

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

/// Adjust the dragged block rotation using the scroll wheel or Q/E keys.
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

/// Delete the targeted block when delete mode is active.
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
            if !super::can_modify_at(pos) {
                return;
            }

            if voxel_type != VoxelType::Bedrock {
                world.set_voxel(pos, VoxelType::Air);
                mark_neighbors_dirty(&mut world, pos);
            }
        }
    }
}

/// Given a desired placement coordinate, drop it to the nearest supported position.
pub fn find_grounded_position(start: IVec3, world: &VoxelWorld) -> Option<IVec3> {
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

/// Mark a block and its neighbors as dirty for mesh regeneration.
pub fn mark_neighbors_dirty(world: &mut VoxelWorld, pos: IVec3) {
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
