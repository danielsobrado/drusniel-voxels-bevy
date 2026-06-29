//! Building system with Enshrouded-style snap point placement.
//!
//! This module provides a modular building system featuring:
//! - Snap point detection for automatic piece alignment
//! - Ghost preview with validity feedback
//! - Grid-based and free placement modes
//! - Building piece registry with configurable snap points

pub mod ghost;
pub mod grid;
pub mod persistence;
pub mod snap;
pub mod stability;
pub mod terrain_conform;
pub mod types;

use bevy::prelude::*;

use crate::input::config::GameAction;
use crate::input::manager::ActionState;

pub use ghost::*;
pub use grid::*;
pub use persistence::*;
pub use snap::*;
pub use stability::*;
pub use terrain_conform::*;
pub use types::*;

/// Plugin for the building system.
pub struct BuildingPlugin;

impl Plugin for BuildingPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<BuildingPieceRegistry>()
            .init_resource::<BuildingGrid>()
            .init_resource::<SnapPointIndex>()
            .init_resource::<BuildingState>()
            .init_resource::<ConstructionPersistenceConfig>()
            .init_resource::<ConstructionPersistenceState>()
            .init_resource::<ConstructionTerrainConformConfig>()
            .init_resource::<SnapConfig>()
            .init_resource::<StabilityConfig>()
            .init_resource::<DirtyStabilityIslands>()
            .init_resource::<PendingStabilityCollapses>()
            .add_message::<ConstructionTerrainConformRequest>()
            .add_systems(
                Startup,
                (setup_building_piece_registry, setup_ghost_materials),
            )
            .add_systems(
                Update,
                (
                    handle_building_input,
                    cleanup_removed_building_pieces,
                    update_snap_point_index,
                    detect_snap_points,
                    update_building_ghost,
                    place_building_piece,
                    delete_aimed_building_piece,
                    recompute_dirty_stability,
                    collapse_unstable_building_pieces,
                    apply_construction_terrain_conform_requests,
                    draw_stability_outlines,
                    load_saved_construction_pieces,
                )
                    .chain(),
            );
    }
}

/// Handle building-related input (snap toggle, rotation).
fn handle_building_input(action_state: Res<ActionState>, mut state: ResMut<BuildingState>) {
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
