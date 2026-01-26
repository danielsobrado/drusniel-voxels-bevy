//! Building system with Enshrouded-style snap point placement.
//!
//! This module provides a modular building system featuring:
//! - Snap point detection for automatic piece alignment
//! - Ghost preview with validity feedback
//! - Grid-based and free placement modes
//! - Building piece registry with configurable snap points

pub mod types;
pub mod snap;
pub mod grid;
pub mod ghost;

use bevy::prelude::*;

use crate::input::config::GameAction;
use crate::input::manager::ActionState;

pub use types::*;
pub use snap::*;
pub use grid::*;
pub use ghost::*;

/// Plugin for the building system.
pub struct BuildingPlugin;

impl Plugin for BuildingPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<BuildingPieceRegistry>()
            .init_resource::<BuildingGrid>()
            .init_resource::<SnapPointIndex>()
            .init_resource::<BuildingState>()
            .init_resource::<SnapConfig>()
            .add_systems(Startup, setup_building_piece_registry)
            .add_systems(
                Update,
                (
                    handle_building_input,
                    update_snap_point_index,
                    detect_snap_points,
                    update_building_ghost,
                    place_building_piece,
                )
                    .chain(),
            );
    }
}

/// Handle building-related input (snap toggle, rotation).
fn handle_building_input(
    action_state: Res<ActionState>,
    mut state: ResMut<BuildingState>,
) {
    // Toggle snap mode
    if action_state.just_pressed(GameAction::ToggleSnapMode) {
        state.snap_enabled = !state.snap_enabled;
        info!(
            "Snap mode: {}",
            if state.snap_enabled { "ON" } else { "OFF" }
        );
    }

    // Rotate piece clockwise
    if action_state.just_pressed(GameAction::RotatePiece) && state.active {
        state.rotate_cw();
        info!("Rotation: {} ({}°)", state.rotation, state.rotation * 90);
    }
}
