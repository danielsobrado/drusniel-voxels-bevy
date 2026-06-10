//! Block editing systems (edit mode, drag & drop, delete mode).
//!
//! This module provides systems for editing the voxel world:
//! - Edit mode: Toggle with Shift+M to enable block dragging
//! - Drag mode: Click and drag blocks to move them
//! - Delete mode: Toggle with Delete key in edit mode to remove blocks

use super::targeting::TargetedBlock;
use crate::interaction::palette::{PlacementPaletteState, PlacementSelection};
use crate::voxel::chunk::MeshDirtyReason;
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::{VoxelEditResult, VoxelSample, VoxelWorld};
use crate::world_rules::{ProtectedAreaRegistry, ProtectedEditIntent};
use bevy::input::mouse::MouseWheel;
use bevy::prelude::*;

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
                apply_edit_and_mark(
                    &mut world,
                    dragged.original_position,
                    dragged.block_type,
                    ProtectedEditIntent::Place,
                    None,
                );
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
                apply_edit_and_mark(
                    &mut world,
                    dragged.original_position,
                    dragged.block_type,
                    ProtectedEditIntent::Place,
                    None,
                );
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
    protected_areas: Option<Res<ProtectedAreaRegistry>>,
) {
    if !edit_mode.enabled || delete_mode.enabled || !mouse.just_pressed(MouseButton::Left) {
        return;
    }

    if drag_state.dragged_block.is_some() {
        return;
    }

    if let (Some(pos), Some(voxel_type)) = (targeted_block.position, targeted_block.voxel_type) {
        if !super::can_modify_at(
            &world,
            pos,
            ProtectedEditIntent::Mine,
            protected_areas.as_deref(),
        ) {
            super::record_edit_rejection_at(
                &mut world,
                pos,
                ProtectedEditIntent::Mine,
                protected_areas.as_deref(),
            );
            return;
        }

        if voxel_type == VoxelType::Bedrock {
            super::record_edit_rejection_at(
                &mut world,
                pos,
                ProtectedEditIntent::Mine,
                protected_areas.as_deref(),
            );
            info!("Cannot break bedrock at {:?}", pos);
            return;
        }

        if apply_edit_and_mark(
            &mut world,
            pos,
            VoxelType::Air,
            ProtectedEditIntent::Mine,
            protected_areas.as_deref(),
        ) {
            drag_state.dragged_block = Some(DraggedBlock {
                block_type: voxel_type,
                original_position: pos,
            });
            drag_state.rotation_degrees = 0.0;
        }
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
    protected_areas: Option<Res<ProtectedAreaRegistry>>,
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
            apply_edit_and_mark(
                &mut world,
                dragged.original_position,
                dragged.block_type,
                ProtectedEditIntent::Place,
                None,
            );
            return;
        };

        if !super::can_modify_at(
            &world,
            grounded_pos,
            ProtectedEditIntent::Place,
            protected_areas.as_deref(),
        ) {
            super::record_edit_rejection_at(
                &mut world,
                grounded_pos,
                ProtectedEditIntent::Place,
                protected_areas.as_deref(),
            );
            apply_edit_and_mark(
                &mut world,
                dragged.original_position,
                dragged.block_type,
                ProtectedEditIntent::Place,
                None,
            );
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
                apply_edit_and_mark(
                    &mut world,
                    dragged.original_position,
                    dragged.block_type,
                    ProtectedEditIntent::Place,
                    None,
                );
                return;
            }
        }

        if let VoxelSample::InBounds(existing) = world.sample_voxel_for_interaction(grounded_pos) {
            if existing == VoxelType::Air || existing == VoxelType::Water {
                if apply_edit_and_mark(
                    &mut world,
                    grounded_pos,
                    dragged.block_type,
                    ProtectedEditIntent::Place,
                    protected_areas.as_deref(),
                ) {
                    return;
                }
                apply_edit_and_mark(
                    &mut world,
                    dragged.original_position,
                    dragged.block_type,
                    ProtectedEditIntent::Place,
                    None,
                );
                return;
            }
        }
    }

    // Restore to the original position if we couldn't place it elsewhere
    apply_edit_and_mark(
        &mut world,
        dragged.original_position,
        dragged.block_type,
        ProtectedEditIntent::Place,
        None,
    );
    drag_state.rotation_degrees = 0.0;
}

/// Adjust the dragged block rotation using the scroll wheel or Q/E keys.
pub fn update_drag_rotation(
    edit_mode: Res<EditMode>,
    delete_mode: Res<DeleteMode>,
    mut drag_state: ResMut<DragState>,
    mut mouse_wheel: MessageReader<MouseWheel>,
    keyboard: Res<ButtonInput<KeyCode>>,
    palette: Res<PlacementPaletteState>,
) {
    if !edit_mode.enabled || delete_mode.enabled {
        return;
    }

    let has_prop_selection = matches!(
        palette.active_selection,
        Some(PlacementSelection::Prop { .. })
    );

    if drag_state.dragged_block.is_none() && !has_prop_selection {
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
    protected_areas: Option<Res<ProtectedAreaRegistry>>,
) {
    if !edit_mode.enabled || !delete_mode.enabled {
        return;
    }

    if mouse.just_pressed(MouseButton::Left) {
        if let (Some(pos), Some(voxel_type)) = (targeted_block.position, targeted_block.voxel_type)
        {
            if !super::can_modify_at(
                &world,
                pos,
                ProtectedEditIntent::Mine,
                protected_areas.as_deref(),
            ) {
                super::record_edit_rejection_at(
                    &mut world,
                    pos,
                    ProtectedEditIntent::Mine,
                    protected_areas.as_deref(),
                );
                return;
            }

            if voxel_type != VoxelType::Bedrock {
                apply_edit_and_mark(
                    &mut world,
                    pos,
                    VoxelType::Air,
                    ProtectedEditIntent::Mine,
                    protected_areas.as_deref(),
                );
            } else {
                super::record_edit_rejection_at(
                    &mut world,
                    pos,
                    ProtectedEditIntent::Mine,
                    protected_areas.as_deref(),
                );
                info!("Cannot break bedrock at {:?}", pos);
            }
        }
    }
}

fn apply_edit_and_mark(
    world: &mut VoxelWorld,
    pos: IVec3,
    voxel: VoxelType,
    intent: ProtectedEditIntent,
    protected_areas: Option<&ProtectedAreaRegistry>,
) -> bool {
    match world.set_voxel_with_rules(pos, voxel, intent, protected_areas) {
        VoxelEditResult::Applied => true,
        VoxelEditResult::NoChange => true,
        _ => false,
    }
}

/// Given a desired placement coordinate, drop it to the nearest supported position.
pub fn find_grounded_position(start: IVec3, world: &VoxelWorld) -> Option<IVec3> {
    if !world.in_bounds(start) {
        return None;
    }

    let mut pos = start;

    // Cannot place inside a solid block
    match world.sample_voxel_for_interaction(pos) {
        VoxelSample::InBounds(voxel) if voxel.is_solid() => return None,
        VoxelSample::InBounds(_) => {}
        _ => return None,
    }

    // Slide downward until we find solid ground
    loop {
        let below = pos + IVec3::NEG_Y;

        if !world.in_bounds(below) {
            return None;
        }

        match world.sample_voxel_for_interaction(below) {
            VoxelSample::InBounds(voxel) if voxel.is_solid() => return Some(pos),
            VoxelSample::InBounds(_) => pos = below,
            _ => return None,
        }
    }
}

/// Mark the edited chunk and any neighbors affected by the 1-voxel mesh halo.
///
/// Prefer `set_voxel` / `apply_voxel_edit` when changing voxels; they already
/// propagate `TerrainMutation` with the same surgical rules in
/// `mesh_invalidation`. Use this only when voxels were changed without `set_voxel`.
pub fn mark_neighbors_dirty(world: &mut VoxelWorld, pos: IVec3) {
    let chunk_pos = VoxelWorld::world_to_chunk(pos);
    if let Some(mut chunk) = world.get_chunk_mut(chunk_pos) {
        chunk.mark_dirty_with_reason(MeshDirtyReason::TerrainMutation);
    }

    let local = VoxelWorld::world_to_local(pos);
    for offset in crate::voxel::mesh_invalidation::mesh_invalidation_neighbor_offsets(local) {
        world.mark_chunk_dirty_with_reason(chunk_pos + offset, MeshDirtyReason::TerrainMutation);
    }
}
